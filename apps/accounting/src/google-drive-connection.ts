import { getServerSession } from "next-auth";
import { and, eq } from "drizzle-orm";
import { getDatabase, providerConnections } from "@beezops/database";
import { authOptions } from "./auth";
import { getWorkspaceForUser } from "./tenant-service";

const nangoApiBaseUrl = "https://api.nango.dev";

interface NangoConnectSessionResponse {
  data?: {
    token?: string;
  };
}

interface NangoConnection {
  connection_id: string;
  provider_config_key: string;
  tags?: Record<string, string>;
  errors?: Array<{ type: string }>;
}

interface NangoConnectionsResponse {
  connections?: NangoConnection[];
}

export interface GoogleDriveConnectionStatus {
  state: "connected" | "not-connected" | "not-configured" | "reauthorization-required";
}

async function getSignedInWorkspace() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;

  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return null;
  return { userId, workspace };
}

function getNangoConfiguration() {
  const secretKey = process.env.NANGO_SECRET_KEY?.trim();
  const integrationKey = process.env.NANGO_GOOGLE_DRIVE_INTEGRATION_KEY?.trim();
  if (!secretKey || !integrationKey) return null;
  return { secretKey, integrationKey };
}

export async function createGoogleDriveConnectSession(): Promise<string | null> {
  const workspace = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!workspace || !config) return null;

  const response = await fetch(`${nangoApiBaseUrl}/connect/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tags: {
        end_user_id: workspace.workspace.id,
        organization_id: workspace.workspace.id,
      },
      allowed_integrations: [config.integrationKey],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    console.error("[connections:google-drive] Could not create Nango connect session", {
      status: response.status,
      response: responseText.slice(0, 500),
    });
    throw new Error("Could not start Google Drive authorization.");
  }

  const result = (await response.json()) as NangoConnectSessionResponse;
  const token = result.data?.token;
  if (!token) throw new Error("Nango did not return a connect-session token.");
  return token;
}

export async function getGoogleDriveConnectionStatus(): Promise<GoogleDriveConnectionStatus> {
  const account = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!account || !config) return { state: "not-configured" };

  const connections = await getDatabase()
    .select({ status: providerConnections.status })
    .from(providerConnections)
    .where(and(
      eq(providerConnections.organizationId, account.workspace.id),
      eq(providerConnections.provider, "google-drive"),
      eq(providerConnections.integrationKey, config.integrationKey),
    ));

  if (connections.some((connection) => connection.status === "active")) return { state: "connected" };
  if (connections.some((connection) => connection.status === "reauthorization_required")) {
    return { state: "reauthorization-required" };
  }
  return { state: "not-connected" };
}

export async function syncGoogleDriveConnections(): Promise<GoogleDriveConnectionStatus> {
  const account = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!account || !config) return { state: "not-configured" };

  const query = new URLSearchParams({
    "tags[end_user_id]": account.workspace.id,
    limit: "100",
  });
  const response = await fetch(`${nangoApiBaseUrl}/connections?${query}`, {
    headers: { Authorization: `Bearer ${config.secretKey}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    console.error("[connections:google-drive] Could not load Nango connection status", {
      status: response.status,
      response: responseText.slice(0, 500),
    });
    throw new Error("Could not load Google Drive connection status.");
  }

  const result = (await response.json()) as NangoConnectionsResponse;
  const scopedConnections = (result.connections ?? []).filter(
    (connection) =>
      connection.provider_config_key === config.integrationKey &&
      connection.tags?.end_user_id === account.workspace.id &&
      connection.tags?.organization_id === account.workspace.id,
  );

  const database = getDatabase();
  const now = new Date();
  await database.transaction(async (transaction) => {
    await transaction
      .update(providerConnections)
      .set({ status: "disconnected", updatedAt: now, lastSyncedAt: now })
      .where(and(
        eq(providerConnections.organizationId, account.workspace.id),
        eq(providerConnections.provider, "google-drive"),
        eq(providerConnections.integrationKey, config.integrationKey),
      ));

    for (const connection of scopedConnections) {
      const requiresReauthorization = connection.errors?.some((error) => error.type === "auth") ?? false;
      await transaction
        .insert(providerConnections)
        .values({
          organizationId: account.workspace.id,
          provider: "google-drive",
          integrationKey: config.integrationKey,
          externalConnectionId: connection.connection_id,
          status: requiresReauthorization ? "reauthorization_required" : "active",
          connectedByUserId: account.userId,
          createdAt: now,
          updatedAt: now,
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            providerConnections.organizationId,
            providerConnections.provider,
            providerConnections.integrationKey,
            providerConnections.externalConnectionId,
          ],
          set: {
            status: requiresReauthorization ? "reauthorization_required" : "active",
            updatedAt: now,
            lastSyncedAt: now,
          },
        });
    }
  });

  return {
    state: scopedConnections.some((connection) => !connection.errors?.some((error) => error.type === "auth"))
      ? "connected"
      : "not-connected",
  };
}
