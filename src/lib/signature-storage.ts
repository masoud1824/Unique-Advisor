import { oneDriveUploadUrl } from "./provider-integrations.ts";
import { uploadToDropbox } from "./dropbox-sign.ts";
import { verifiedFolderId } from "./signature-workflow.ts";

export async function storeSignedFile(input: {
  storage: string;
  folder: string;
  name: string;
  bytes: Uint8Array;
  token: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl || fetch;
  if (input.storage === "dropbox") {
    if (!input.folder.startsWith("/")) return { ok: false as const, error: "Dropbox needs a verified folder path beginning with /. I did not file the document." };
    const saved = await uploadToDropbox(input.token, input.folder, input.name, input.bytes, fetchImpl);
    if (!saved.ok || !saved.filed) return { ok: false as const, error: saved.ok ? "The file was not saved." : saved.error };
    return { ok: true as const, path: saved.path, link: `https://www.dropbox.com/home${saved.path.slice(0, saved.path.lastIndexOf("/"))}?preview=${encodeURIComponent(input.name)}` };
  }
  if (input.storage === "box") {
    if (!verifiedFolderId("box", input.folder)) return { ok: false as const, error: "Box needs a verified folder id. I did not file the document in another service." };
    const form = new FormData();
    form.set("attributes", JSON.stringify({ name: input.name, parent: { id: input.folder } }));
    form.set("file", new Blob([Buffer.from(input.bytes)]), input.name);
    const response = await fetchImpl("https://upload.box.com/api/2.0/files/content", { method: "POST", headers: { Authorization: `Bearer ${input.token}` }, body: form });
    if (!response.ok) return { ok: false as const, error: "Box did not save the file. The signature request was not sent again." };
    const json = await response.json() as { entries?: Array<{ id?: string }> };
    const id = json.entries?.[0]?.id || "";
    return { ok: true as const, path: id, link: id ? `https://app.box.com/file/${id}` : "" };
  }
  if (input.storage === "google_drive") {
    if (!verifiedFolderId("google_drive", input.folder)) return { ok: false as const, error: "Google Drive needs a verified folder id. I did not file the document in another service." };
    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify({ name: input.name, parents: [input.folder] })], { type: "application/json" }));
    form.set("file", new Blob([Buffer.from(input.bytes)], { type: "application/pdf" }), input.name);
    const response = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { Authorization: `Bearer ${input.token}` }, body: form });
    if (!response.ok) return { ok: false as const, error: "Google Drive did not save the file. The signature request was not sent again." };
    const json = await response.json() as { id?: string; webViewLink?: string };
    return { ok: true as const, path: json.id || "", link: json.webViewLink || (json.id ? `https://drive.google.com/file/d/${json.id}/view` : "") };
  }
  if (input.storage === "onedrive") {
    if (!verifiedFolderId("onedrive", input.folder)) return { ok: false as const, error: "OneDrive needs a verified folder id. I did not file the document in another service." };
    const response = await fetchImpl(oneDriveUploadUrl(input.folder, input.name), {
      method: "PUT",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/pdf" },
      body: Buffer.from(input.bytes),
    });
    if (!response.ok) return { ok: false as const, error: "OneDrive did not save the file. The signature request was not sent again." };
    const json = await response.json() as { id?: string; webUrl?: string };
    return { ok: true as const, path: json.id || "", link: json.webUrl || "" };
  }
  return { ok: false as const, error: "That storage provider is not available. I did not use another storage provider." };
}
