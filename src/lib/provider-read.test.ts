import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isDropboxListAsk } from "./advisor-intent.ts";
import { connectionSetupBlocked } from "./isolated-test-desk.ts";

describe("staging provider reads", () => {
  it("recognizes a Dropbox file list and not an upload", () => {
    assert.equal(isDropboxListAsk("show my Dropbox files"), true);
    assert.equal(isDropboxListAsk("upload this file to Dropbox"), false);
  });

  it("lists on staging and still blocks inbox reads on the isolated copy", () => {
    const previous = {
      flag: process.env.UA_ISOLATED_TEST,
      dir: process.env.PGLITE_DATA_DIR,
      release: process.env.UA_RELEASE_ENV,
      outbound: process.env.UA_OUTBOUND_BLOCK,
    };
    process.env.UA_RELEASE_ENV = "staging";
    process.env.UA_OUTBOUND_BLOCK = "1";
    delete process.env.UA_ISOLATED_TEST;
    assert.equal(connectionSetupBlocked(), false);
    process.env.UA_ISOLATED_TEST = "1";
    process.env.PGLITE_DATA_DIR = "/workspace/.preview-data/pglite-isolated-test-20261118";
    assert.equal(connectionSetupBlocked(), true);
    const source = readFileSync(new URL("./microsoft-mail.ts", import.meta.url), "utf8");
    const inbox = source.slice(source.indexOf("export async function graphInbox"), source.indexOf("export async function graphMe"));
    const send = source.slice(source.indexOf("export async function graphSendMail"), source.indexOf("export async function graphSendMail") + 420);
    assert.equal(inbox.includes("connectionSetupBlocked()"), true);
    assert.equal(inbox.includes("outboundBlocked()"), false);
    assert.equal(send.includes("outboundBlocked()"), true);
    if (previous.flag === undefined) delete process.env.UA_ISOLATED_TEST;
    else process.env.UA_ISOLATED_TEST = previous.flag;
    if (previous.dir === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = previous.dir;
    if (previous.release === undefined) delete process.env.UA_RELEASE_ENV;
    else process.env.UA_RELEASE_ENV = previous.release;
    if (previous.outbound === undefined) delete process.env.UA_OUTBOUND_BLOCK;
    else process.env.UA_OUTBOUND_BLOCK = previous.outbound;
  });
});
