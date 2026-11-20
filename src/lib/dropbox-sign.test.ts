import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropboxSignEventHash, eventIsAuthentic, filingNames, filesUrl, parseCallbackBody, readSendResult, sendPayload, statusFromEvent, uploadToDropbox, dropboxSignRefusal, dropboxSignTokenRequest, CALLBACK_ACK, type SignRequest } from "./dropbox-sign.ts";

const request: SignRequest = {
  advisorId: "4",
  documentId: "application",
  version: "v3",
  filename: "application.pdf",
  subject: "Please sign",
  message: "Test only.",
  signers: [
    { name: "Alex Example", email: "alex.example@test.invalid", order: 1 },
    { name: "Jordan Example", email: "jordan.example@test.invalid", order: 2 },
  ],
  fields: [
    { signerEmail: "alex.example@test.invalid", kind: "signature", page: 1, x: 80, y: 600, width: 160, height: 30 },
    { signerEmail: "jordan.example@test.invalid", kind: "initial", page: 1, x: 80, y: 540, width: 40, height: 30 },
  ],
  testMode: true,
};

describe("Dropbox Sign", () => {
  it("builds a test-mode request and refuses missing placement or a missing request id", () => {
    const built = sendPayload(request, "app-client");
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.form.get("test_mode"), "1");
    assert.equal(built.form.get("signers[1][email_address]"), "jordan.example@test.invalid");
    assert.equal(built.form.get("metadata[version]"), "v3");
    const fields = JSON.parse(String(built.form.get("form_fields_per_document")));
    assert.equal(fields[0][1].signer, 1);
    assert.equal(sendPayload({ ...request, fields: [] }, "app-client").ok, false);
    assert.equal(readSendResult(200, { signature_request: {} }).ok, false);
    const accepted = readSendResult(200, { signature_request: { signature_request_id: "req_1", is_complete: false } });
    assert.equal(accepted.ok && accepted.requestId, "req_1");
    assert.equal(filesUrl("req_1", "pdf"), "https://api.hellosign.com/v3/signature_request/files/req_1?file_type=pdf");
    assert.equal(filesUrl("req_1", "zip"), "https://api.hellosign.com/v3/signature_request/files/req_1?file_type=zip");
  });

  it("verifies callbacks and marks completed only when every signer is finished", () => {
    const hash = dropboxSignEventHash("api-key", "1710000000", "signature_request_all_signed");
    assert.equal(eventIsAuthentic("api-key", "1710000000", "signature_request_all_signed", hash), true);
    assert.equal(eventIsAuthentic("other-key", "1710000000", "signature_request_all_signed", hash), false);
    assert.equal(statusFromEvent("signature_request_signed", false), "partially_signed");
    assert.equal(statusFromEvent("signature_request_all_signed", true), "completed");
    assert.equal(statusFromEvent("signature_request_declined", false), "declined");
    assert.equal(statusFromEvent("signature_request_sent", false), "sent");
  });

  it("accepts a valid signed callback and rejects an invalid signature", () => {
    const hash = dropboxSignEventHash("api-key", "1348177752", "callback_test");
    assert.equal(eventIsAuthentic("api-key", "1348177752", "callback_test", hash), true);
    assert.equal(eventIsAuthentic("api-key", "1348177752", "callback_test", `${hash.slice(0, -1)}0`), false);
    assert.equal(eventIsAuthentic("api-key", "1348177752", "callback_test", ""), false);
    const parsed = parseCallbackBody("multipart/form-data; boundary=x", "not-json", JSON.stringify({ event: { event_type: "callback_test", event_time: "1348177752", event_hash: hash } }));
    assert.equal(eventIsAuthentic("api-key", parsed?.event?.event_time || "", parsed?.event?.event_type || "", parsed?.event?.event_hash || ""), true);
    assert.equal(CALLBACK_ACK, "Hello API Event Received");
  });

  it("retries filing without sending another signature request", async () => {
    const names = filingNames("application", "req_1", ["application-original.pdf"]);
    assert.equal(names.signed, "application-signed-req_1.pdf");
    assert.notEqual(names.signed, "application-original.pdf");
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(String(url));
      assert.equal(String(url).includes("signature_request/send"), false);
      assert.match(String((init?.headers as Record<string, string>)["Dropbox-API-Arg"]), /"mode":"add"/);
      return new Response("{}", { status: 200 });
    };
    const missing = await uploadToDropbox("", "/Clients/C-1001", names.signed, new Uint8Array([1]), fetchImpl);
    assert.equal(missing.filed, false);
    const saved = await uploadToDropbox("token", "/Clients/C-1001", names.signed, new Uint8Array([1]), fetchImpl);
    assert.equal(saved.ok && saved.filed, true);
    assert.equal(calls.length, 1);
    const again = filingNames("application", "req_1", [names.signed]);
    assert.notEqual(again.signed, names.signed);
  });

  it("exchanges the OAuth code at app.hellosign.com and keeps the redirect URI out of the token body", () => {
    const request = dropboxSignTokenRequest({
      grantType: "authorization_code",
      clientId: "client-test",
      clientSecret: "secret-test",
      code: "code-test",
      state: "state-test",
    });
    assert.equal(request.endpoint, "https://app.hellosign.com/oauth/token");
    assert.equal("redirect_uri" in request.body, false);
    assert.equal(request.body.grant_type, "authorization_code");
    assert.equal(request.body.state, "state-test");
    const refresh = dropboxSignTokenRequest({
      grantType: "refresh_token",
      clientId: "client-test",
      clientSecret: "secret-test",
      refreshToken: "refresh-test",
    });
    assert.equal(refresh.endpoint, "https://app.hellosign.com/oauth/token?refresh");
    assert.equal(refresh.body.grant_type, "refresh_token");
    const refusal = dropboxSignRefusal(404, '{"error":{"error_msg":"Invalid URI. Make sure you have the correct URI and HTTP method.","error_name":"not_found"}}');
    assert.match(refusal, /HTTP 404 not_found/);
    assert.doesNotMatch(refusal, /secret|code-test|client-test/);
  });
});
