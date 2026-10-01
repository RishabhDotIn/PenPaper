"use client";

import {
  DriveAuthError,
  getAccessToken,
  getSession,
  renewSession,
} from "./auth";
import {
  BOARD_FILE_MIME,
  DRIVE_FOLDER_NAME,
  boardFileName,
  isBoardDocument,
  titleFromFileName,
  type DriveBoardDocument,
} from "./document";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** A board file in the account's Drive, as the shelf sees it. */
export interface RemoteBoard {
  fileId: string;
  boardId: string;
  title: string;
  modifiedTime: string;
  /** Monotonic server revision; the cheapest way to know a file changed. */
  version: string;
}

export class DriveRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DriveRequestError";
  }
}

interface DriveFileResource {
  id?: string;
  name?: string;
  version?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

const LIST_FIELDS = "files(id,name,version,modifiedTime,appProperties),nextPageToken";

function timeout(ms: number): AbortSignal | undefined {
  // Older Safari has no AbortSignal.timeout; the request simply runs unbounded
  // there rather than failing every Drive call.
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Drive returned ${response.status}`;
  } catch {
    return `Drive returned ${response.status}`;
  }
}

/**
 * One authorised call, with a single retry after reconnecting.
 *
 * A 401 here does not mean the user is signed out — tokens expire after an
 * hour, and Google may invalidate one early. Reconnecting costs a popup that is
 * usually instantaneous because consent already exists.
 */
async function call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new DriveAuthError("Not connected to Google Drive", "no-token");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...init, headers, signal: timeout(20_000) });

  if (response.status === 401 && retry) {
    await renewSession();
    return call(url, init, false);
  }

  if (!response.ok) {
    throw new DriveRequestError(await errorMessage(response), response.status);
  }

  return response;
}

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await call(url, init);
  return (await response.json()) as T;
}

function toRemote(file: DriveFileResource): RemoteBoard | null {
  const boardId = file.appProperties?.boardId;
  if (!boardId || !file.id) return null;
  return {
    fileId: file.id,
    boardId,
    title: file.name ? titleFromFileName(file.name) : "Untitled notepad",
    modifiedTime: file.modifiedTime ?? new Date(0).toISOString(),
    version: file.version ?? "0",
  };
}

function listUrl(query: string, fields = LIST_FIELDS): string {
  const params = new URLSearchParams({
    q: query,
    fields,
    pageSize: "1000",
    orderBy: "modifiedTime desc",
    spaces: "drive",
  });
  return `${API}/files?${params.toString()}`;
}

async function listAll(query: string, fields = LIST_FIELDS): Promise<DriveFileResource[]> {
  const files: DriveFileResource[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const url = new URL(listUrl(query, fields));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const body = await json<{ files?: DriveFileResource[]; nextPageToken?: string }>(
      url.toString(),
    );
    if (body.files) files.push(...body.files);
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  return files;
}

let folderLookup: { email: string; id: Promise<string> } | null = null;

/**
 * The visible `PenPaper` folder in My Drive.
 *
 * Visible on purpose: the library belongs to the user, so they can see it,
 * download it, and copy it out of Drive without asking us. It is found by an
 * app-private property rather than a name, so renaming it in Drive does not
 * strand the app with a duplicate.
 */
export async function ensureFolder(): Promise<string> {
  const account = getSession()?.account.email ?? "";
  if (folderLookup && folderLookup.email === account) return folderLookup.id;

  const id = (async () => {
    const existing = await listAll(
      `mimeType = '${FOLDER_MIME}' and appProperties has { key='penpaperFolder' and value='1' } and trashed = false`,
      "files(id,name)",
    );
    const found = existing[0]?.id;
    if (found) return found;

    const created = await json<DriveFileResource>(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: FOLDER_MIME,
        appProperties: { penpaperFolder: "1" },
      }),
    });

    if (!created.id) throw new DriveRequestError("Drive did not create the folder", 500);
    return created.id;
  })();

  folderLookup = { email: account, id };
  // A failed lookup must not be cached, or every save retries a dead promise.
  id.catch(() => {
    if (folderLookup?.id === id) folderLookup = null;
  });

  return id;
}

export async function listRemoteBoards(): Promise<RemoteBoard[]> {
  const files = await listAll(
    "appProperties has { key='penpaper' and value='1' } and trashed = false",
  );
  return files.map(toRemote).filter((board): board is RemoteBoard => board !== null);
}

export async function findRemoteBoard(boardId: string): Promise<RemoteBoard | null> {
  const files = await listAll(
    `appProperties has { key='boardId' and value='${boardId.replace(/'/g, "")}' } and trashed = false`,
    "files(id,name,version,modifiedTime,appProperties)",
  );
  const board = files.map(toRemote).find((candidate) => candidate?.boardId === boardId);
  return board ?? null;
}

export async function statRemoteBoard(fileId: string): Promise<RemoteBoard | null> {
  const token = getAccessToken();
  if (!token) throw new DriveAuthError("Not connected to Google Drive", "no-token");

  const response = await fetch(
    `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,version,modifiedTime,appProperties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: timeout(12_000) },
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new DriveRequestError(await errorMessage(response), response.status);

  return toRemote((await response.json()) as DriveFileResource);
}

export async function downloadBoard(fileId: string): Promise<DriveBoardDocument> {
  const response = await call(
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
    {},
  );
  const body: unknown = await response.json();
  if (!isBoardDocument(body)) {
    throw new DriveRequestError("That Drive file is not a PenPaper board", 422);
  }
  return body;
}

export interface UploadInput {
  fileId?: string;
  title: string;
  document: DriveBoardDocument;
}

function multipartBody(metadata: Record<string, unknown>, document: DriveBoardDocument) {
  const boundary = `penpaper-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${BOARD_FILE_MIME}; charset=UTF-8`,
    "",
    JSON.stringify(document),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return { boundary, body };
}

export async function uploadBoard({
  fileId,
  title,
  document,
}: UploadInput): Promise<RemoteBoard> {
  const metadata: Record<string, unknown> = {
    name: boardFileName(title),
    mimeType: BOARD_FILE_MIME,
    appProperties: { penpaper: "1", boardId: document.boardId },
  };

  if (!fileId) metadata.parents = [await ensureFolder()];

  const { boundary, body } = multipartBody(metadata, document);
  const url = fileId
    ? `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,version,modifiedTime,appProperties`
    : `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,version,modifiedTime,appProperties`;

  const saved = await json<DriveFileResource>(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });

  const remote = toRemote(saved);
  if (!remote) throw new DriveRequestError("Drive did not return the saved board", 500);
  return remote;
}

export async function trashBoard(fileId: string): Promise<void> {
  await call(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Test seam: forget the cached folder lookup. */
export function __resetDriveApiForTests(): void {
  folderLookup = null;
}
