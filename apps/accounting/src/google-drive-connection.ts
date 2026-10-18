import { getServerSession } from "next-auth";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase, providerConnections } from "@beezops/database";
import { authOptions } from "./auth";
import { getWorkspaceForUser } from "./tenant-service";

const nangoApiBaseUrl = "https://api.nango.dev";

type ConnectionRecordStatus = "active" | "disconnected" | "reauthorization_required";

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

export interface GoogleDriveConnectionSummary {
  connectionId: string;
  status: ConnectionRecordStatus;
  createdAt: string;
  lastSyncedAt: string | null;
}

export interface GoogleDriveConnectionStatus {
  state: "connected" | "not-connected" | "not-configured" | "reauthorization-required";
  connections: GoogleDriveConnectionSummary[];
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

function isAuthorizationError(connection: NangoConnection) {
  return connection.errors?.some((error) => error.type === "auth") ?? false;
}

async function readGoogleDriveConnectionStatus(organizationId: string, integrationKey: string): Promise<GoogleDriveConnectionStatus> {
  const records = await getDatabase()
    .select({
      connectionId: providerConnections.externalConnectionId,
      status: providerConnections.status,
      createdAt: providerConnections.createdAt,
      lastSyncedAt: providerConnections.lastSyncedAt,
    })
    .from(providerConnections)
    .where(and(
      eq(providerConnections.organizationId, organizationId),
      eq(providerConnections.provider, "google-drive"),
      eq(providerConnections.integrationKey, integrationKey),
    ))
    .orderBy(desc(providerConnections.createdAt));

  const connections: GoogleDriveConnectionSummary[] = records.map((record) => ({
    connectionId: record.connectionId,
    status: record.status as ConnectionRecordStatus,
    createdAt: record.createdAt.toISOString(),
    lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
  }));

  const state = connections.some((connection) => connection.status === "active")
    ? "connected"
    : connections.some((connection) => connection.status === "reauthorization_required")
      ? "reauthorization-required"
      : "not-connected";

  return { state, connections };
}

export async function createGoogleDriveConnectSession(): Promise<string | null> {
  const account = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!account || !config) return null;

  const response = await fetch(`${nangoApiBaseUrl}/connect/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tags: {
        end_user_id: account.workspace.id,
        organization_id: account.workspace.id,
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
  if (!account || !config) return { state: "not-configured", connections: [] };

  return readGoogleDriveConnectionStatus(account.workspace.id, config.integrationKey);
}

export async function syncGoogleDriveConnections(): Promise<GoogleDriveConnectionStatus> {
  const account = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!account || !config) return { state: "not-configured", connections: [] };

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
      const status = isAuthorizationError(connection) ? "reauthorization_required" : "active";
      await transaction
        .insert(providerConnections)
        .values({
          organizationId: account.workspace.id,
          provider: "google-drive",
          integrationKey: config.integrationKey,
          externalConnectionId: connection.connection_id,
          status,
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
            status,
            updatedAt: now,
            lastSyncedAt: now,
          },
        });
    }
  });

  return readGoogleDriveConnectionStatus(account.workspace.id, config.integrationKey);
}

export async function disconnectGoogleDriveConnection(connectionId: string): Promise<void> {
  const account = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!account || !config) throw new Error("Google Drive is not configured for this workspace.");

  const [connection] = await getDatabase()
    .select({ id: providerConnections.id, externalConnectionId: providerConnections.externalConnectionId })
    .from(providerConnections)
    .where(and(
      eq(providerConnections.organizationId, account.workspace.id),
      eq(providerConnections.provider, "google-drive"),
      eq(providerConnections.integrationKey, config.integrationKey),
      eq(providerConnections.externalConnectionId, connectionId),
    ))
    .limit(1);

  if (!connection) throw new Error("Google Drive connection was not found in this workspace.");

  const query = new URLSearchParams({ provider_config_key: config.integrationKey });
  const response = await fetch(
    `${nangoApiBaseUrl}/connections/${encodeURIComponent(connection.externalConnectionId)}?${query}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.secretKey}` },
      cache: "no-store",
    },
  );

  if (!response.ok && response.status !== 404) {
    const responseText = await response.text();
    console.error("[connections:google-drive] Could not disconnect Nango connection", {
      status: response.status,
      response: responseText.slice(0, 500),
    });
    throw new Error("Could not disconnect Google Drive. The connection is still active.");
  }

  const now = new Date();
  await getDatabase()
    .update(providerConnections)
    .set({ status: "disconnected", updatedAt: now, lastSyncedAt: now })
    .where(and(
      eq(providerConnections.id, connection.id),
      eq(providerConnections.organizationId, account.workspace.id),
    ));
}
