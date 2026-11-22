import { chooseDropboxDocument, WORKFLOW_DOCUMENT, workflowPreviewText, workflowSignField } from "@/lib/signature-workflow-document";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";

type Listed = { name?: string; path_display?: string; ".tag"?: string; content_hash?: string; size?: number };
type PdfOpenOptions = { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean };

async function dropbox(token: string, url: string, arg: unknown, body?: Uint8Array) {
  const payload: BodyInit | undefined = body
    ? new Blob([body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer])
    : url.includes("content.dropboxapi.com")
      ? undefined
      : JSON.stringify(arg);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(url.includes("content.dropboxapi.com")
        ? { "Dropbox-API-Arg": JSON.stringify(arg), "Content-Type": "application/octet-stream" }
        : { "Content-Type": "application/json" }),
    },
    body: payload,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let json: { entries?: Listed[]; path_display?: string; name?: string; content_hash?: string; size?: number } | null = null;
  try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { json = null; }
  return { status: response.status, bytes, json };
}

export async function listWorkflowFolder(token: string) {
  const listed = await dropbox(token, "https://api.dropboxapi.com/2/files/list_folder", { path: WORKFLOW_DOCUMENT.folder, recursive: false });
  if (listed.status !== 200) return { ok: false as const, error: `I could not list ${WORKFLOW_DOCUMENT.folder}. Nothing was sent.` };
  const files = (listed.json?.entries || [])
    .filter((entry) => entry[".tag"] === "file" && entry.name)
    .map((entry) => ({
      name: String(entry.name),
      path: String(entry.path_display || `${WORKFLOW_DOCUMENT.folder}/${entry.name}`),
      hash: String(entry.content_hash || ""),
      size: Number(entry.size || 0),
    }));
  return { ok: true as const, files };
}

export async function readSelectedWorkflow(token: string, title = WORKFLOW_DOCUMENT.title) {
  const listed = await listWorkflowFolder(token);
  if (!listed.ok) return listed;
  const choice = chooseDropboxDocument(listed.files, title);
  if (!choice.ok) return { ...choice, sent: false as const };
  const downloaded = await dropbox(token, "https://content.dropboxapi.com/2/files/download", { path: choice.file.path });
  if (downloaded.status !== 200) return { ok: false as const, error: `Dropbox did not return ${choice.file.name}. Nothing was sent.`, sent: false as const };
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfOptions: PdfOpenOptions = { data: downloaded.bytes.slice(0), disableWorker: true, isEvalSupported: false };
  const doc = await getDocument(pdfOptions).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  if (!text.includes(WORKFLOW_DOCUMENT.title) || !/\bSignature\b/.test(text)) {
    return { ok: false as const, error: "The selected file does not show the title and a Signature label. I did not guess a box or send a request.", sent: false as const };
  }
  const view = page.getViewport({ scale: 1 });
  const field = workflowSignField(view.height);
  return {
    ok: true as const,
    sent: false as const,
    path: choice.file.path,
    name: choice.file.name,
    pages: doc.numPages,
    width: view.width,
    height: view.height,
    field,
    preview: workflowPreviewText({ path: choice.file.path, field }),
    bytes: downloaded.bytes,
  };
}

export async function addWorkflowDocument(token: string, bytes: Uint8Array) {
  if (externalSideEffectsBlocked()) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  const listed = await listWorkflowFolder(token);
  if (!listed.ok) return listed;
  if (listed.files.some((file) => file.name === WORKFLOW_DOCUMENT.fileName)) {
    return { ok: false as const, error: "That file already exists. Nothing was replaced." };
  }
  const uploaded = await dropbox(token, "https://content.dropboxapi.com/2/files/upload", {
    path: `${WORKFLOW_DOCUMENT.folder}/${WORKFLOW_DOCUMENT.fileName}`,
    mode: "add",
    autorename: false,
    mute: true,
  }, bytes);
  if (uploaded.status !== 200) return { ok: false as const, error: "The new document was not added.", status: uploaded.status };
  return { ok: true as const, path: uploaded.json?.path_display || "", name: uploaded.json?.name || "", hash: uploaded.json?.content_hash || "", size: uploaded.json?.size || 0 };
}
