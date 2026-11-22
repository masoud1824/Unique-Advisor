export const SIGNATURE_STEPS = [
  "choose-document",
  "identify-signers",
  "preview",
  "approve",
  "send",
  "track",
  "file",
  "notify",
] as const;

export type SignatureService = "dropbox_sign" | "docusign" | "adobe_sign";
export type StorageService = "dropbox" | "box" | "google_drive" | "onedrive";
export type Capability = "full" | "partial" | "unsupported";

export type ServiceCapability = {
  service: string;
  role: "signature" | "storage";
  level: Capability;
  detail: string;
};

export const SERVICE_CAPABILITIES: ServiceCapability[] = [
  { service: "Dropbox Sign", role: "signature", level: "full", detail: "Connected and live-tested: test mode, status checks, signed PDF, filing, and notices. Preview webhooks remain blocked." },
  { service: "DocuSign", role: "signature", level: "partial", detail: "Demo sending, status, and document retrieval are coded. No DocuSign app is saved and no live test has succeeded." },
  { service: "Adobe Acrobat Sign", role: "signature", level: "partial", detail: "Agreement sending, status, and audit retrieval are coded for the North America shard. No Adobe app is saved and no live test has succeeded." },
  { service: "Dropbox", role: "storage", level: "full", detail: "Connected and live-tested filing by verified folder path. The signed PDF matched Dropbox Sign. The audit file contents were not downloaded." },
  { service: "Box", role: "storage", level: "partial", detail: "Folder check, upload, and file retrieval are coded. No Box app is saved, no folder id is verified, and no live test has succeeded." },
  { service: "Google Drive", role: "storage", level: "partial", detail: "Folder-id upload and file retrieval are coded. No Drive app is saved, no folder id is verified, and no live test has succeeded." },
  { service: "OneDrive", role: "storage", level: "partial", detail: "A separate Microsoft Files connection, upload, and retrieval are coded. No OneDrive app is saved and no live test has succeeded." },
];

export function serviceLevel(name: string): Capability {
  const found = SERVICE_CAPABILITIES.find((item) => item.service.toLowerCase() === name.toLowerCase());
  return found?.level || "unsupported";
}

const SIGNATURE_NAMES: Record<SignatureService, string> = {
  dropbox_sign: "Dropbox Sign",
  docusign: "DocuSign",
  adobe_sign: "Adobe Acrobat Sign",
};

const STORAGE_NAMES: Record<StorageService, string> = {
  dropbox: "Dropbox",
  box: "Box",
  google_drive: "Google Drive",
  onedrive: "OneDrive",
};

export function namedService(text: string): { signature?: SignatureService; storage?: StorageService } {
  const tidy = String(text || "").toLowerCase();
  const remainder = tidy.replace(/\bdropbox sign\b/g, "");
  const signature = /\badobe(?:\s+acrobat)?\s+sign\b/.test(tidy) ? "adobe_sign" : /\bdocusign\b/.test(tidy) ? "docusign" : /\bdropbox sign\b/.test(tidy) ? "dropbox_sign" : undefined;
  const storage = /\bonedrive\b/.test(remainder) ? "onedrive" : /\bgoogle drive\b/.test(remainder) ? "google_drive" : /\bbox\b/.test(remainder) ? "box" : /\bdropbox\b/.test(remainder) ? "dropbox" : undefined;
  return { signature, storage };
}

export function chooseSignatureWorkflow(input: {
  connectedSignatures: string[];
  connectedStores: string[];
  preferredSignature?: string;
  preferredStore?: string;
  requestedSignature?: string;
  requestedStore?: string;
  folder?: string;
}) {
  const requestedSignature = input.requestedSignature || "";
  const requestedStore = input.requestedStore || "";
  if (requestedSignature && serviceLevel(SIGNATURE_NAMES[requestedSignature as SignatureService] || requestedSignature) === "unsupported") {
    return { ok: false as const, error: `${SIGNATURE_NAMES[requestedSignature as SignatureService] || requestedSignature} is not available. I did not use another signature provider.` };
  }
  if (requestedStore && serviceLevel(STORAGE_NAMES[requestedStore as StorageService] || requestedStore) === "unsupported") {
    return { ok: false as const, error: `${STORAGE_NAMES[requestedStore as StorageService] || requestedStore} is not a filing destination. I did not use another storage provider.` };
  }
  const signatures = input.connectedSignatures.filter((item): item is SignatureService => item === "dropbox_sign" || item === "docusign" || item === "adobe_sign");
  const stores = input.connectedStores.filter((item): item is StorageService => item === "dropbox" || item === "box" || item === "google_drive" || item === "onedrive");
  const signatureRequest = (signatures as readonly string[]).includes(requestedSignature) ? requestedSignature as SignatureService : "";
  const storageRequest = (stores as readonly string[]).includes(requestedStore) ? requestedStore as StorageService : "";
  if (requestedSignature && !signatureRequest) {
    return { ok: false as const, error: `${SIGNATURE_NAMES[requestedSignature as SignatureService] || requestedSignature} is not connected for this advisor. I did not use another signature provider.` };
  }
  if (requestedStore && !storageRequest) {
    return { ok: false as const, error: `${STORAGE_NAMES[requestedStore as StorageService] || requestedStore} is not connected for this advisor. I did not use another storage provider.` };
  }
  const preferredSignature = input.preferredSignature && signatures.some((item) => item === input.preferredSignature) ? input.preferredSignature as SignatureService : "";
  const preferredStore = input.preferredStore && stores.some((item) => item === input.preferredStore) ? input.preferredStore as StorageService : "";
  const signature = signatureRequest || preferredSignature || (signatures.length === 1 ? signatures[0] : "");
  const storage = storageRequest || preferredStore || (stores.length === 1 ? stores[0] : "");
  if (!signature) return { ok: false as const, ask: true as const, error: `Which signature provider should I use? ${signatures.map((item) => SIGNATURE_NAMES[item as SignatureService] || item).join(", ") || "None is connected."}` };
  if (!storage) return { ok: false as const, ask: true as const, error: `Which storage destination should I use? ${stores.map((item) => STORAGE_NAMES[item as StorageService] || item).join(", ") || "None is connected."}` };
  const folder = String(input.folder || "");
  if (storage === "dropbox" && !folder.startsWith("/")) return { ok: false as const, error: "Dropbox needs a verified folder path beginning with /. I did not file the document." };
  if ((storage === "box" || storage === "google_drive" || storage === "onedrive") && !verifiedFolderId(storage, folder)) {
    return { ok: false as const, error: `${STORAGE_NAMES[storage]} needs a verified folder id. I did not file the document in another service.` };
  }
  return { ok: true as const, signature, storage, folder };
}

export function verifiedFolderId(storage: string, folder: string) {
  if (storage === "box") return /^\d+$/.test(folder) && folder !== "0";
  if (storage === "google_drive" || storage === "onedrive") return /^[A-Za-z0-9!_-]{10,}$/.test(folder);
  return false;
}

export function approvalStillMatches(prepared: string, approved: string) {
  return prepared.length > 0 && prepared === approved;
}

export function uniqueFilingName(name: string, existing: string[]) {
  if (!existing.includes(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${stem}-copy-${existing.length + 1}${ext}`;
}
