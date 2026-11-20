import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adobeAgreementRequest, boxFolderUrl, docusignEnvelopeRequest, mapAdobeStatus, mapDocuSignStatus, oneDriveUploadUrl, readSignatureStatus } from "./provider-integrations.ts";

describe("simulated provider integrations", () => {
  it("builds DocuSign, Box, OneDrive, and Adobe requests without calling them", () => {
    const envelope = docusignEnvelopeRequest({ accountId: "acc-1", baseUrl: "https://demo.docusign.net", subject: "TEST ONLY", email: "masoudz@outlook.com", name: "Masoud Zangeneh", pdfBase64: "abc" });
    assert.equal(envelope.method, "POST");
    assert.match(envelope.url, /\/accounts\/acc-1\/envelopes$/);
    assert.equal(envelope.body.recipients.signers[0].email, "masoudz@outlook.com");
    assert.equal(envelope.body.status, "sent");
    assert.equal(boxFolderUrl("12345"), "https://api.box.com/2.0/folders/12345?fields=id,type,name");
    assert.match(oneDriveUploadUrl("folderId1234", "test-only-signed-1.pdf"), /conflictBehavior=rename/);
    const adobe = adobeAgreementRequest({ transientDocumentId: "td-1", subject: "TEST ONLY", email: "masoudz@outlook.com" });
    assert.equal(adobe.body.participantSetsInfo[0].memberInfos[0].email, "masoudz@outlook.com");
    assert.equal(mapDocuSignStatus("completed"), "completed");
    assert.equal(mapDocuSignStatus("delivered"), "viewed");
    assert.equal(mapAdobeStatus("SIGNED"), "completed");
    assert.equal(mapAdobeStatus("EXPIRED"), "expired");
  });

  it("reads simulated DocuSign and Adobe status and does not call Dropbox Sign", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("userinfo")) {
        return new Response(JSON.stringify({ accounts: [{ account_id: "acc-1", is_default: true, base_uri: "https://demo.docusign.net" }] }), { status: 200 });
      }
      if (String(url).includes("adobesign")) return new Response(JSON.stringify({ status: "SIGNED" }), { status: 200 });
      return new Response(JSON.stringify({ status: "completed" }), { status: 200 });
    }) as typeof fetch;
    const docusign = await readSignatureStatus({ provider: "docusign", requestId: "env-1", token: "token", fetchImpl });
    assert.equal(docusign.ok && docusign.status, "completed");
    const adobe = await readSignatureStatus({ provider: "adobe_sign", requestId: "agr-1", token: "token", fetchImpl });
    assert.equal(adobe.ok && adobe.status, "completed");
    assert.equal(calls.some((url) => url.includes("hellosign") || url.includes("dropboxapi")), false);
  });
});
