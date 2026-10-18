import { and, eq } from "drizzle-orm";
import { getDatabase, providerConnections } from "@beezops/database";

const nangoApiBaseUrl = "https://api.nango.dev";

export class DriveApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DriveApiError";
  }
}

export interface DriveInvoiceFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  version: string;
  size: string | null;
  webViewLink: string | null;
}

export interface DriveFolder {
  id: string;
  name: string;
}

interface DriveFileResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  version?: string;
  size?: string;
  webViewLink?: string;
}

interface DriveFilesResponse {
  files?: DriveFileResponse[];
  nextPageToken?: string;
}

function getNangoConfiguration() {
  const secretKey = process.env.NANGO_SECRET_KEY?.trim();
  const integrationKey = process.env.NANGO_GOOGLE_DRIVE_INTEGRATION_KEY?.trim();
  if (!secretKey || !integrationKey) throw new Error("Google Drive connection is not configured.");
  return { secretKey, integrationKey };
}

async function getActiveDriveConnection(organizationId: string, externalConnectionId: string) {
  const { integrationKey } = getNangoConfiguration();
  const [connection] = await getDatabase()
    .select({
      id: providerConnections.id,
      externalConnectionId: providerConnections.externalConnectionId,
      integrationKey: providerConnections.integrationKey,
    })
    .from(providerConnections)
    .where(and(
      eq(providerConnections.organizationId, organizationId),
      eq(providerConnections.provider, "google-drive"),
      eq(providerConnections.integrationKey, integrationKey),
      eq(providerConnections.externalConnectionId, externalConnectionId),
      eq(providerConnections.status, "active"),
    ))
    .limit(1);
  if (!connection) throw new Error("Choose an active Google Drive connection in this workspace.");
  return connection;
}

async function requestDriveApi(
  organizationId: string,
  externalConnectionId: string,
  path: string,
  query?: URLSearchParams,
): Promise<Response> {
  const config = getNangoConfiguration();
  const connection = await getActiveDriveConnection(organizationId, externalConnectionId);
  const suffix = query?.size ? `?${query.toString()}` : "";
  return fetch(`${nangoApiBaseUrl}/proxy/${path}${suffix}`, {
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Connection-Id": connection.externalConnectionId,
      "Provider-Config-Key": connection.integrationKey,
    },
    cache: "no-store",
  });
}

function normalizeDriveFile(file: DriveFileResponse): DriveInvoiceFile | null {
  if (!file.id || !file.name || !file.mimeType) return null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime ?? "",
    version: file.version ?? file.modifiedTime ?? "",
    size: file.size ?? null,
    webViewLink: file.webViewLink ?? null,
  };
}

export async function listDriveInvoiceFolder(
  organizationId: string,
  externalConnectionId: string,
  folderId: string,
): Promise<{ files: DriveInvoiceFile[]; folders: DriveFolder[] }> {
  const parent = folderId === "root" ? "'root' in parents" : "'" + folderId.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "' in parents";
  const entries: DriveInvoiceFile[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      q: parent + " and trashed=false",
      pageSize: "1000",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,version,size,webViewLink)",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await requestDriveApi(organizationId, externalConnectionId, "drive/v3/files", query);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      console.error("[accounting:invoice-intake] Drive file listing failed", { status: response.status, detail });
      throw new DriveApiError("Could not list files from Google Drive.", response.status);
    }
    const payload = (await response.json()) as DriveFilesResponse;
    entries.push(...(payload.files ?? []).map(normalizeDriveFile).filter((file): file is DriveInvoiceFile => file !== null));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return {
    files: entries.filter((file) => file.mimeType !== "application/vnd.google-apps.folder"),
    folders: entries
      .filter((file) => file.mimeType === "application/vnd.google-apps.folder")
      .map((folder) => ({ id: folder.id, name: folder.name })),
  };
}

export async function getDriveInvoiceFile(
  organizationId: string,
  externalConnectionId: string,
  fileId: string,
): Promise<DriveInvoiceFile> {
  const query = new URLSearchParams({
    fields: "id,name,mimeType,modifiedTime,version,size,webViewLink",
  });
  const response = await requestDriveApi(
    organizationId,
    externalConnectionId,
    `drive/v3/files/${encodeURIComponent(fileId)}`,
    query,
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[accounting:invoice-intake] Drive file metadata request failed", { status: response.status, detail });
    throw new DriveApiError("Could not access that file through the selected Google Drive connection.", response.status);
  }
  const file = normalizeDriveFile((await response.json()) as DriveFileResponse);
  if (!file) throw new Error("Google Drive returned incomplete file details.");
  if (file.mimeType !== "application/pdf") throw new Error("Manual extraction currently supports PDF invoices.");
  return file;
}

export async function getDriveInvoiceFolder(
  organizationId: string,
  externalConnectionId: string,
  folderId: string,
): Promise<DriveFolder> {
  const query = new URLSearchParams({ fields: "id,name,mimeType" });
  const response = await requestDriveApi(
    organizationId,
    externalConnectionId,
    `drive/v3/files/${encodeURIComponent(folderId)}`,
    query,
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[accounting:invoice-intake] Drive folder metadata request failed", { status: response.status, detail });
    throw new DriveApiError("Could not access that folder through the selected Google Drive connection.", response.status);
  }
  const folder = (await response.json()) as DriveFileResponse;
  if (!folder.id || !folder.name || folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Choose a Google Drive folder for invoice intake.");
  }
  return { id: folder.id, name: folder.name };
}

export async function downloadDriveInvoicePdf(
  organizationId: string,
  externalConnectionId: string,
  fileId: string,
  expectedVersion: string,
): Promise<{ base64: string; file: DriveInvoiceFile }> {
  const file = await getDriveInvoiceFile(organizationId, externalConnectionId, fileId);
  if (file.version !== expectedVersion) {
    throw new Error("This Drive file changed after it was selected. Refresh the file list and try again.");
  }
  const response = await requestDriveApi(
    organizationId,
    externalConnectionId,
    `drive/v3/files/${encodeURIComponent(fileId)}`,
    new URLSearchParams({ alt: "media" }),
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[accounting:invoice-intake] Drive PDF download failed", { status: response.status, detail });
    throw new DriveApiError("Could not download the PDF from Google Drive.", response.status);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 4_500_000) {
    throw new Error("This PDF is too large for the current extraction path. Choose a file under 4.5 MB.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 4_500_000) {
    throw new Error("This PDF is too large for the current extraction path. Choose a file under 4.5 MB.");
  }
  return { base64: bytes.toString("base64"), file };
}
