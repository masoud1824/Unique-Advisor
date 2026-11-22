import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  ISOLATED_TEST_DIR,
  externalSideEffectsBlocked,
  isolatedProviderNotice,
  refusePreviewDataDir,
} from "./isolated-test-desk.ts";

const ORIGINAL = {
  flag: process.env.UA_ISOLATED_TEST,
  dir: process.env.PGLITE_DATA_DIR,
};

afterEach(() => {
  if (ORIGINAL.flag === undefined) delete process.env.UA_ISOLATED_TEST;
  else process.env.UA_ISOLATED_TEST = ORIGINAL.flag;
  if (ORIGINAL.dir === undefined) delete process.env.PGLITE_DATA_DIR;
  else process.env.PGLITE_DATA_DIR = ORIGINAL.dir;
});

describe("isolated test desk gate", () => {
  it("blocks external side effects only for the named test copy", () => {
    process.env.UA_ISOLATED_TEST = "1";
    process.env.PGLITE_DATA_DIR = ISOLATED_TEST_DIR;
    assert.equal(externalSideEffectsBlocked(), true);
    assert.equal(refusePreviewDataDir(ISOLATED_TEST_DIR), null);
  });

  it("refuses the damaged original, its backup, and the healthy sources while isolation is on", () => {
    process.env.UA_ISOLATED_TEST = "1";
    process.env.PGLITE_DATA_DIR = ISOLATED_TEST_DIR;
    for (const dir of [
      "/workspace/.preview-data/pglite",
      "/workspace/.preview-data/pglite-untouched-20261119",
      "/workspace/.preview-data/pglite-work",
      "/tmp/pglite-copy",
      "/tmp/pglite-read",
      "/tmp/pgrecover",
      "",
    ]) {
      assert.equal(typeof refusePreviewDataDir(dir), "string", dir);
    }
  });

  it("refuses the test copy when isolation is off, and does not claim side effects are blocked", () => {
    delete process.env.UA_ISOLATED_TEST;
    delete process.env.UA_OUTBOUND_BLOCK;
    delete process.env.UA_RELEASE_ENV;
    delete process.env.UA_HOST_ENV;
    delete process.env.VERCEL_ENV;
    process.env.PGLITE_DATA_DIR = ISOLATED_TEST_DIR;
    assert.equal(externalSideEffectsBlocked(), false);
    assert.equal(typeof refusePreviewDataDir(ISOLATED_TEST_DIR), "string");
    assert.equal(refusePreviewDataDir("/workspace/.preview-data/pglite"), null);
  });

  it("blocks a Vercel preview and a staging host even when the release flag was forgotten", () => {
    delete process.env.UA_OUTBOUND_BLOCK;
    delete process.env.UA_RELEASE_ENV;
    delete process.env.UA_ISOLATED_TEST;
    process.env.VERCEL_ENV = "preview";
    assert.equal(externalSideEffectsBlocked(), true);
    delete process.env.VERCEL_ENV;
    process.env.UA_HOST_ENV = "staging";
    assert.equal(externalSideEffectsBlocked(), true);
    delete process.env.UA_HOST_ENV;
    process.env.VERCEL_ENV = "production";
    process.env.UA_HOST_ENV = "production";
    assert.equal(externalSideEffectsBlocked(), false);
    delete process.env.VERCEL_ENV;
    delete process.env.UA_HOST_ENV;
  });

  it("describes a stored link without calling the provider", () => {
    assert.match(isolatedProviderNotice("dropbox", true), /still linked/i);
    assert.match(isolatedProviderNotice("dropbox", true), /will not contact Dropbox/i);
    assert.match(isolatedProviderNotice("dropbox", false), /not connected/i);
    assert.match(isolatedProviderNotice("mailbox", true), /still stored/i);
    assert.match(isolatedProviderNotice("mailbox", true), /will not contact the mailbox/i);
    assert.match(isolatedProviderNotice("mailbox", false), /no connected mailbox/i);
    assert.match(isolatedProviderNotice("dropbox", null), /could not be checked/i);
  });
});
