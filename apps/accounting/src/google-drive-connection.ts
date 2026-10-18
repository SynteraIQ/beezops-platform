import { getServerSession } from "next-auth";
import { and, desc, eq, sql } from "drizzle-orm";
import { documentSourceItems, documentSources, getDatabase, providerConnections } from "@beezops/database";
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

interface GoogleDriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
}

interface GoogleDriveFilesResponse {
  files?: GoogleDriveFile[];
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

export interface GoogleDriveFolderSummary {
  id: string;
  name: string;
}

export interface GoogleDriveDocumentSource {
  id: string;
  connectionId: string;
  name: string;
  path: string;
  provider: "google-drive";
  status: string;
  lastSyncedAt: string | null;
  connectionStatus: string;
}

export interface GoogleDriveSourceSyncResult {
  source: GoogleDriveDocumentSource;
  discoveredCount: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  syncedAt: string;
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

export class GoogleDriveDiscoveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GoogleDriveDiscoveryError";
  }
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

async function getActiveGoogleDriveConnection(connectionIdValue: string) {
  const connectionId = connectionIdValue.trim();
  if (connectionId.length === 0 || connectionId.length > 255) {
    throw new GoogleDriveDiscoveryError("Choose a valid Google Drive account.", 400);
  }
  const account = await getSignedInWorkspace();
  if (!account) throw new GoogleDriveDiscoveryError("Sign in and choose a workspace to search Google Drive.", 401);

  const config = getNangoConfiguration();
  if (!config) throw new GoogleDriveDiscoveryError("Google Drive is not configured for this environment.", 503);

  const [connection] = await getDatabase()
    .select({ id: providerConnections.id, connectionId: providerConnections.externalConnectionId })
    .from(providerConnections)
    .where(and(
      eq(providerConnections.organizationId, account.workspace.id),
      eq(providerConnections.provider, "google-drive"),
      eq(providerConnections.integrationKey, config.integrationKey),
      eq(providerConnections.externalConnectionId, connectionId),
      eq(providerConnections.status, "active"),
    ))
    .limit(1);

  if (!connection) {
    throw new GoogleDriveDiscoveryError("Choose an active Google Drive account from this workspace.", 404);
  }

  return { providerConnectionId: connection.id, connectionId, config, organizationId: account.workspace.id, userId: account.userId };
}

export async function listGoogleDriveDocumentSources(): Promise<GoogleDriveDocumentSource[]> {
  const account = await getSignedInWorkspace();
  if (!account) throw new GoogleDriveDiscoveryError("Sign in and choose a workspace to view document sources.", 401);
  const rows = await getDatabase()
    .select({
      id: documentSources.id,
      connectionId: providerConnections.externalConnectionId,
      name: documentSources.name,
      path: documentSources.path,
      provider: documentSources.provider,
      status: documentSources.status,
      lastSyncedAt: documentSources.lastSyncedAt,
      connectionStatus: providerConnections.status,
    })
    .from(documentSources)
    .innerJoin(providerConnections, eq(documentSources.providerConnectionId, providerConnections.id))
    .where(and(
      eq(documentSources.organizationId, account.workspace.id),
      eq(documentSources.provider, "google-drive"),
    ))
    .orderBy(desc(documentSources.createdAt));
  return rows.map((row) => ({
    ...row,
    provider: "google-drive",
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  }));
}

export async function saveGoogleDriveDocumentSource(input: {
  connectionId: string;
  folderId: string;
  name: string;
  path: string;
}): Promise<GoogleDriveDocumentSource> {
  const connection = await getActiveGoogleDriveConnection(input.connectionId);
  const folderId = input.folderId.trim();
  const name = input.name.trim();
  const path = input.path.trim();
  if (!folderId || folderId.length > 512 || !name || name.length > 500 || !path || path.length > 2000) {
    throw new GoogleDriveDiscoveryError("Choose a valid Drive folder.", 400);
  }
  const now = new Date();
  const [source] = await getDatabase()
    .insert(documentSources)
    .values({
      organizationId: connection.organizationId,
      providerConnectionId: connection.providerConnectionId,
      provider: "google-drive",
      externalSourceId: folderId,
      name,
      path,
      status: "active",
      createdByUserId: connection.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [documentSources.organizationId, documentSources.providerConnectionId, documentSources.externalSourceId],
      set: { name, path, status: "active", updatedAt: now },
    })
    .returning({ id: documentSources.id, name: documentSources.name, path: documentSources.path, provider: documentSources.provider, status: documentSources.status, lastSyncedAt: documentSources.lastSyncedAt });
  return {
    ...source,
    provider: "google-drive",
    connectionId: connection.connectionId,
    connectionStatus: "active",
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function syncGoogleDriveDocumentSource(sourceIdValue: string): Promise<GoogleDriveSourceSyncResult> {
  const account = await getSignedInWorkspace();
  if (!account) throw new GoogleDriveDiscoveryError("Sign in and choose a workspace to sync document sources.", 401);
  const sourceId = sourceIdValue.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    throw new GoogleDriveDiscoveryError("Choose a valid document source.", 400);
  }
  const [sourceRow] = await getDatabase()
    .select({
      id: documentSources.id,
      folderId: documentSources.externalSourceId,
      name: documentSources.name,
      path: documentSources.path,
      provider: documentSources.provider,
      status: documentSources.status,
      lastSyncedAt: documentSources.lastSyncedAt,
      connectionId: providerConnections.externalConnectionId,
      connectionStatus: providerConnections.status,
    })
    .from(documentSources)
    .innerJoin(providerConnections, eq(documentSources.providerConnectionId, providerConnections.id))
    .where(and(
      eq(documentSources.id, sourceId),
      eq(documentSources.organizationId, account.workspace.id),
      eq(documentSources.provider, "google-drive"),
      eq(providerConnections.status, "active"),
      eq(documentSources.status, "active"),
    ))
    .limit(1);
  if (!sourceRow) throw new GoogleDriveDiscoveryError("This source or its Google Drive connection is no longer active.", 404);

  const files = await listGoogleDriveSourceFiles(sourceRow.connectionId, sourceRow.folderId);
  const database = getDatabase();
  const existingRows = await database
    .select({ externalItemId: documentSourceItems.externalItemId, externalVersion: documentSourceItems.externalVersion })
    .from(documentSourceItems)
    .where(and(
      eq(documentSourceItems.organizationId, account.workspace.id),
      eq(documentSourceItems.documentSourceId, sourceRow.id),
    ));
  const existingById = new Map(existingRows.map((row) => [row.externalItemId, row.externalVersion]));
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  const syncedAt = new Date();
  for (const file of files) {
    if (!existingById.has(file.id)) newCount += 1;
    else if (existingById.get(file.id) !== file.modifiedTime) changedCount += 1;
    else unchangedCount += 1;
  }

  await database.transaction(async (transaction) => {
    if (files.length > 0) {
      await transaction
        .insert(documentSourceItems)
        .values(files.map((file) => ({
          organizationId: account.workspace.id,
          documentSourceId: sourceRow.id,
          externalItemId: file.id,
          externalVersion: file.modifiedTime,
          status: "discovered",
          firstSeenAt: syncedAt,
          lastSeenAt: syncedAt,
          updatedAt: syncedAt,
        })))
        .onConflictDoUpdate({
          target: [documentSourceItems.documentSourceId, documentSourceItems.externalItemId],
          set: {
            externalVersion: sql`excluded.external_version`,
            status: "discovered",
            lastSeenAt: syncedAt,
            updatedAt: syncedAt,
          },
        });
    }
    await transaction
      .update(documentSources)
      .set({ lastSyncedAt: syncedAt, updatedAt: syncedAt })
      .where(and(eq(documentSources.id, sourceRow.id), eq(documentSources.organizationId, account.workspace.id)));
  });

  return {
    source: {
      id: sourceRow.id,
      connectionId: sourceRow.connectionId,
      name: sourceRow.name,
      path: sourceRow.path,
      provider: "google-drive",
      status: sourceRow.status,
      lastSyncedAt: syncedAt.toISOString(),
      connectionStatus: sourceRow.connectionStatus,
    },
    discoveredCount: files.length,
    newCount,
    changedCount,
    unchangedCount,
    syncedAt: syncedAt.toISOString(),
  };
}

function getDriveQuery(parentFolderId: string) {
  const parentFolderIdTrimmed = parentFolderId.trim();
  if (parentFolderIdTrimmed.length === 0 || parentFolderIdTrimmed.length > 255) {
    throw new GoogleDriveDiscoveryError("Choose a valid Drive folder.", 400);
  }

  const escapedFolderId = parentFolderIdTrimmed.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const queryParts = [`'${escapedFolderId}' in parents`, "trashed = false"];
  return queryParts.join(" and ");
}

async function requestDriveFiles(
  connectionId: string,
  integrationKey: string,
  secretKey: string,
  driveQuery: URLSearchParams,
) {
  try {
    const response = await fetch(`${nangoApiBaseUrl}/proxy/drive/v3/files?${driveQuery}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Connection-Id": connectionId,
        "Provider-Config-Key": integrationKey,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[invoices:google-drive] Metadata request failed", { status: response.status, connectionId });
      throw new GoogleDriveDiscoveryError(
        "Could not search Google Drive. Check that the connected account has Drive metadata access, then reconnect if needed.",
        502,
      );
    }
    return await response.json() as GoogleDriveFilesResponse;
  } catch (error) {
    if (error instanceof GoogleDriveDiscoveryError) throw error;
    console.error("[invoices:google-drive] Metadata request failed", { connectionId });
    throw new GoogleDriveDiscoveryError("Could not reach Google Drive. Try again.", 502);
  }
}

export async function listGoogleDriveFolders(
  connectionId: string,
  parentFolderId: string,
): Promise<GoogleDriveFolderSummary[]> {
  const connection = await getActiveGoogleDriveConnection(connectionId);
  const parent = parentFolderId.trim();
  if (parent.length === 0 || parent.length > 255) {
    throw new GoogleDriveDiscoveryError("Choose a valid Drive folder.", 400);
  }
  const escapedParent = parent.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const driveQuery = new URLSearchParams({
    q: `'${escapedParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    pageSize: "100",
    orderBy: "name",
    corpora: "user",
    fields: "files(id,name,mimeType)",
  });
  const result = await requestDriveFiles(
    connection.connectionId,
    connection.config.integrationKey,
    connection.config.secretKey,
    driveQuery,
  );
  return (result.files ?? []).flatMap((folder): GoogleDriveFolderSummary[] =>
    folder.id && folder.name ? [{ id: folder.id, name: folder.name }] : [],
  );
}

async function listGoogleDriveSourceFiles(connectionId: string, folderId: string) {
  const connection = await getActiveGoogleDriveConnection(connectionId);
  const q = getDriveQuery(folderId);
  const driveQuery = new URLSearchParams({
    q,
    pageSize: "100",
    orderBy: "modifiedTime desc",
    corpora: "user",
    fields: "files(id,modifiedTime)",
  });
  const result = await requestDriveFiles(
    connection.connectionId,
    connection.config.integrationKey,
    connection.config.secretKey,
    driveQuery,
  );
  return (result.files ?? []).flatMap((file) => file.id ? [{ id: file.id, modifiedTime: file.modifiedTime ?? null }] : []);
}
