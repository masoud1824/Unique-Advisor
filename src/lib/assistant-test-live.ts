import { PDFDocument } from "pdf-lib";

export const ASSISTANT_TEST_ROOT = "/Unique Advisor/Assistant Test";
export const CLIENT_FOLDER = `${ASSISTANT_TEST_ROOT}/C-1001`;

export function testPathAllowed(path: string) {
  return path === ASSISTANT_TEST_ROOT || path.startsWith(`${ASSISTANT_TEST_ROOT}/`);
}

type ListedEntry = { name?: string; path_lower?: string; server_modified?: string; size?: number; ".tag"?: string };
type DropboxJson = { error?: { required_scope?: string }; error_summary?: string; entries?: ListedEntry[]; email?: string } | null;

async function dropbox(token: string, url: string, arg: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(url.includes("content.dropboxapi.com")
        ? { "Dropbox-API-Arg": JSON.stringify(arg) }
        : { "Content-Type": "application/json" }),
    },
    body: url.includes("content.dropboxapi.com") ? undefined : JSON.stringify(arg),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json: DropboxJson = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, bytes, json, text: text.slice(0, 240) };
}

function scopeError(result: { status: number; json: DropboxJson; text: string }) {
  const scope = result.json?.error?.required_scope || "";
  if (result.status === 401 || result.status === 403) return scope ? `missing Dropbox permission: ${scope}` : `Dropbox refused the call (${result.status}). ${result.text}`;
  return "";
}

export async function readAssistantClient(token: string, clientId: string) {
  const wanted = clientId.trim();
  if (!/^C-\d+$/i.test(wanted)) {
    return { ok: false as const, detail: `No file in ${ASSISTANT_TEST_ROOT} matches that identifier. I did not open another client folder.` };
  }
  const root = await dropbox(token, "https://api.dropboxapi.com/2/files/list_folder", { path: ASSISTANT_TEST_ROOT, recursive: false });
  if (root.status !== 200) return { ok: false as const, detail: scopeError(root) || `I could not list ${ASSISTANT_TEST_ROOT}. I did not open another folder.` };
  const child = (root.json?.entries || []).find((entry) => String(entry.name || "").toLowerCase() === wanted.toLowerCase() && entry[".tag"] !== "file");
  if (!child?.name) return { ok: false as const, detail: `No file in ${ASSISTANT_TEST_ROOT} matches that identifier. I did not open another client folder.` };
  const folder = `${ASSISTANT_TEST_ROOT}/${child.name}`;
  if (!testPathAllowed(folder)) return { ok: false as const, detail: "That path is outside the test folder. I did not open it." };
  const listed = await dropbox(token, "https://api.dropboxapi.com/2/files/list_folder", { path: folder, recursive: false });
  if (listed.status !== 200) return { ok: false as const, detail: scopeError(listed) || `I could not list ${folder}. I did not open another folder.` };
  const entries = (listed.json?.entries || []).filter((entry) => entry[".tag"] === "file" && entry.name);
  const files: Array<{ name: string; path: string; modified: string; size: number; text: string }> = [];
  const pdfs: Array<{ name: string; path: string; modified: string; bytes: Uint8Array }> = [];
  for (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    if (!testPathAllowed(path)) continue;
    const lower = String(entry.name).toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".pdf")) continue;
    const downloaded = await dropbox(token, "https://content.dropboxapi.com/2/files/download", { path });
    if (downloaded.status !== 200) return { ok: false as const, detail: scopeError(downloaded) || `Dropbox did not return ${entry.name}. I did not open another folder.` };
    if (lower.endsWith(".txt")) files.push({ name: String(entry.name), path, modified: String(entry.server_modified || ""), size: downloaded.bytes.length, text: new TextDecoder().decode(downloaded.bytes) });
    else pdfs.push({ name: String(entry.name), path, modified: String(entry.server_modified || ""), bytes: downloaded.bytes });
  }
  const inspected = [];
  for (const pdf of pdfs) inspected.push(await inspectSavedPdf(pdf));
  return { ok: true as const, folder, files, pdfs: inspected };
}

export async function visibleEdition(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfOptions: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean } = { data: bytes.slice(0), disableWorker: true, isEvalSupported: false };
  const doc = await getDocument(pdfOptions).promise;
  const pages = [1, Math.min(3, doc.numPages), doc.numPages];
  const seen = [];
  for (const pageNo of [...new Set(pages)]) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    const compact = text.replace(/\s+/g, "");
    const match = /LP2576\/26/i.test(compact);
    const view = page.getViewport({ scale: 1 });
    seen.push({ page: pageNo, edition: match ? "LP257 6/26" : "", width: view.width, height: view.height });
  }
  return { pages: doc.numPages, edition: seen.find((item) => item.edition)?.edition || "", checks: seen };
}

export async function pageBox(bytes: Uint8Array, pageNo: number) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfOptions: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean } = { data: bytes.slice(0), disableWorker: true, isEvalSupported: false };
  const doc = await getDocument(pdfOptions).promise;
  const page = await doc.getPage(Math.min(doc.numPages, Math.max(1, pageNo)));
  const view = page.getViewport({ scale: 1 });
  return { width: view.width, height: view.height, pages: doc.numPages };
}

async function inspectSavedPdf(pdf: { name: string; path: string; modified: string; bytes: Uint8Array }) {
  const doc = await PDFDocument.load(pdf.bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const textOf = (name: string) => {
    try { return form.getTextField(name).getText() || ""; } catch { return ""; }
  };
  const signed = form.getFields().flatMap((field) => {
    if (!/sign/i.test(field.getName())) return [];
    let widgets: Array<{ page: number; x: number; y: number; width: number; height: number }> = [];
    try {
      widgets = field.acroField.getWidgets().map((widget) => {
        const rect = widget.getRectangle();
        const page = doc.getPages().findIndex((item) => item.ref === widget.P()) + 1;
        return { page, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      });
    } catch {
      widgets = [];
    }
    return [{ name: field.getName(), type: field.constructor.name, widgets }];
  });
  const edition = await visibleEdition(pdf.bytes);
  return {
    name: pdf.name,
    path: pdf.path,
    modified: pdf.modified,
    bytes: pdf.bytes.length,
    pages: doc.getPageCount(),
    title: doc.getTitle() || "",
    subject: doc.getSubject() || "",
    edition: edition.edition,
    pageWidth: edition.checks[0]?.width || 0,
    pageHeight: edition.checks[0]?.height || 0,
    firstName: textOf("3 First Name"),
    lastName: textOf("3 First Name 2"),
    province: textOf("Text Field 225"),
    city: textOf("5 City 2"),
    policy: textOf("Policy No 2"),
    sin: textOf("4 SIN 2"),
    signed,
    signatureWidgets: signed.filter((field) => field.type === "PDFSignature").length,
    binary: pdf.bytes,
  };
}
