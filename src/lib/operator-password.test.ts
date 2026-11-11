import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateOperatorPassword } from "./operator-password.ts";

describe("preview operator password", () => {
  it("rejects the public default and short passwords", () => {
    assert.match(privateOperatorPassword("superadmin"), /default/);
    assert.match(privateOperatorPassword("Superadmin"), /default/);
    assert.match(privateOperatorPassword("short"), /8/);
  });

  it("accepts a private password without echoing it", () => {
    assert.equal(privateOperatorPassword("preview-lock-1948"), "");
  });
});
