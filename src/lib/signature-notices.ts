export type SignatureNoticeKind = "signed" | "filed" | "signed-filed" | "filing-failed";

export type PlannedNotice = {
  kind: SignatureNoticeKind;
  body: string;
  folder: string;
  signedPath: string;
  auditPath: string;
};

export function documentLabel(documentId: string) {
  if (documentId === "test-only") return "TEST ONLY";
  if (documentId === "signature-workflow-test") return "Signature Workflow Test";
  const label = String(documentId || "").trim();
  return label || "The document";
}

export function dropboxWebLink(path: string) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean || path === "unavailable") return "";
  const parts = clean.split("/").filter(Boolean);
  const file = parts.pop() || "";
  if (!file || parts.length === 0) return "";
  return `https://www.dropbox.com/home/${parts.map(encodeURIComponent).join("/")}?preview=${encodeURIComponent(file)}`;
}

export function planSignatureNotices(input: {
  documentId: string;
  folder: string;
  completed: boolean;
  filedSigned: boolean;
  filedAudit: boolean;
  filingFailed: boolean;
  existingKinds: string[];
  signedPath?: string;
  auditPath?: string;
  backfill?: boolean;
}): PlannedNotice[] {
  const kinds = new Set(input.existingKinds);
  const label = documentLabel(input.documentId);
  const folder = input.folder || "the destination folder";
  const signedPath = input.filedSigned ? String(input.signedPath || "") : "";
  const auditPath = input.filedAudit ? String(input.auditPath || "") : "";
  const fileLines = [
    signedPath ? `Signed PDF: ${signedPath.split("/").pop()}` : "",
    auditPath ? `Audit file: ${auditPath.split("/").pop()}` : "",
  ].filter(Boolean);
  const saved = `${label} is fully signed and saved in ${folder}.${fileLines.length ? ` ${fileLines.join(". ")}.` : ""}`;
  const out: PlannedNotice[] = [];
  const alreadyCombined = kinds.has("signed-filed");
  const together = input.completed && input.filedSigned && !kinds.has("signed") && !alreadyCombined && !kinds.has("filing-failed");
  const backfillTogether = Boolean(input.backfill) && input.completed && input.filedSigned && kinds.size === 0;
  if (together || backfillTogether) {
    out.push({ kind: "signed-filed", body: saved, folder, signedPath, auditPath });
    return out;
  }
  if (input.filingFailed && !input.filedSigned && !kinds.has("filing-failed") && !alreadyCombined && !kinds.has("signed")) {
    out.push({
      kind: "filing-failed",
      body: `Signed successfully; saving failed. ${label} was not saved in ${folder}. You can retry filing without sending the signature request again.`,
      folder,
      signedPath: "",
      auditPath: "",
    });
    return out;
  }
  if (input.completed && !kinds.has("signed") && !alreadyCombined && !kinds.has("filing-failed")) {
    out.push({
      kind: "signed",
      body: `${label} is fully signed.${input.filedSigned ? "" : " Saving the completed files has not finished."}`,
      folder,
      signedPath: "",
      auditPath: "",
    });
    kinds.add("signed");
  }
  if (input.filedSigned && (kinds.has("signed") || kinds.has("filing-failed")) && !kinds.has("filed") && !alreadyCombined) {
    out.push({
      kind: "filed",
      body: `${label} is saved in ${folder}.${fileLines.length ? ` ${fileLines.join(". ")}.` : ""}`,
      folder,
      signedPath,
      auditPath,
    });
  }
  if (input.filingFailed && !input.filedSigned && !kinds.has("filing-failed") && !alreadyCombined) {
    out.push({
      kind: "filing-failed",
      body: `Signed successfully; saving failed. ${label} was not saved in ${folder}. You can retry filing without sending the signature request again.`,
      folder,
      signedPath: "",
      auditPath: "",
    });
  }
  return out;
}
