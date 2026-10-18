import { getServerSession } from "next-auth";
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
  state: "connected" | "not-connected" | "not-configured";
}

async function getSignedInWorkspace() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;

  return getWorkspaceForUser(userId);
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
        end_user_id: workspace.id,
        organization_id: workspace.id,
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
  const workspace = await getSignedInWorkspace();
  const config = getNangoConfiguration();
  if (!workspace || !config) return { state: "not-configured" };

  const query = new URLSearchParams({
    "tags[end_user_id]": workspace.id,
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
  const activeConnection = result.connections?.find(
    (connection) =>
      connection.provider_config_key === config.integrationKey &&
      connection.tags?.end_user_id === workspace.id &&
      connection.tags?.organization_id === workspace.id &&
      !connection.errors?.some((error) => error.type === "auth"),
  );

  return { state: activeConnection ? "connected" : "not-connected" };
}
