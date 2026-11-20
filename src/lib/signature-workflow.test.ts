import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { storeSignedFile } from "./signature-storage.ts";
import { approvalStillMatches, chooseSignatureWorkflow, namedService, SERVICE_CAPABILITIES, uniqueFilingName } from "./signature-workflow.ts";

const connected = { connectedSignatures: ["dropbox_sign"], connectedStores: ["dropbox"], preferredSignature: "dropbox_sign", preferredStore: "dropbox", folder: "/Unique Advisor/Dropbox Sign Test" };

describe("simulated signature workflow", () => {
  it("keeps the provider the advisor asked for and asks when more than one store is connected", () => {
    const chosen = chooseSignatureWorkflow(connected);
    assert.equal(chosen.ok && chosen.signature, "dropbox_sign");
    assert.equal(chosen.ok && chosen.storage, "dropbox");
    const docusign = chooseSignatureWorkflow({ ...connected, requestedSignature: "docusign" });
    assert.equal(docusign.ok, false);
    if (!docusign.ok) assert.match(docusign.error, /did not use another signature provider/);
    const adobe = chooseSignatureWorkflow({ ...connected, requestedSignature: "adobe_sign" });
    assert.equal(adobe.ok, false);
    const onedrive = chooseSignatureWorkflow({ ...connected, requestedStore: "onedrive" });
    assert.equal(onedrive.ok, false);
    if (!onedrive.ok) assert.match(onedrive.error, /did not use another storage provider/);
    const ask = chooseSignatureWorkflow({ ...connected, connectedStores: ["dropbox", "box"], preferredStore: "" });
    assert.equal(ask.ok, false);
    if (!ask.ok) assert.match(ask.error, /Which storage destination/);
    const boxMissing = chooseSignatureWorkflow({ ...connected, connectedStores: ["box"], preferredStore: "box", requestedStore: "box", folder: "/Unique Advisor" });
    assert.equal(boxMissing.ok, false);
    if (!boxMissing.ok) assert.match(boxMissing.error, /verified folder id/);
    assert.equal(approvalStillMatches("same", "same"), true);
    assert.equal(approvalStillMatches("version-1", "version-2"), false);
    assert.equal(uniqueFilingName("test-only-audit-1.zip", ["test-only-audit-1.zip"]), "test-only-audit-1-copy-2.zip");
    assert.equal(namedService("Send this with DocuSign").signature, "docusign");
    assert.equal(namedService("File it in OneDrive").storage, "onedrive");
  });

  it("files only in the selected service during a simulated upload", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ entries: [{ id: "box-file-1" }], id: "drive-file-1", webViewLink: "https://drive.google.com/file/d/drive-file-1/view" }), { status: 200 });
    }) as typeof fetch;
    const box = await storeSignedFile({ storage: "box", folder: "12345", name: "test-only-signed-1.pdf", bytes: new Uint8Array([1]), token: "token", fetchImpl });
    assert.equal(box.ok && box.link, "https://app.box.com/file/box-file-1");
    const drive = await storeSignedFile({ storage: "google_drive", folder: "folderId1234", name: "test-only-signed-1.pdf", bytes: new Uint8Array([1]), token: "token", fetchImpl });
    assert.equal(drive.ok && drive.path, "drive-file-1");
    const wrongBox = await storeSignedFile({ storage: "box", folder: "/Unique Advisor", name: "x.pdf", bytes: new Uint8Array([1]), token: "token", fetchImpl });
    assert.equal(wrongBox.ok, false);
    const one = await storeSignedFile({ storage: "onedrive", folder: "root", name: "x.pdf", bytes: new Uint8Array([1]), token: "token", fetchImpl });
    assert.equal(one.ok, false);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((url) => !url.includes("dropboxapi") && !url.includes("hellosign")), true);
  });
});

describe("actual provider coverage", () => {
  it("records only Dropbox Sign and Dropbox as fully implemented", () => {
    const full = SERVICE_CAPABILITIES.filter((item) => item.level === "full").map((item) => item.service);
    assert.deepEqual(full, ["Dropbox Sign", "Dropbox"]);
    assert.equal(SERVICE_CAPABILITIES.some((item) => item.level !== "full" && /supported/i.test(item.detail)), false);
  });
});
