import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fictionalAddress, placementPreview } from "./signature-placement.ts";

const base = {
  path: "/Unique Advisor/Assistant Test/C-1001/form.pdf",
  edition: "LP257 6/26",
  page: 3,
  x: 40,
  y: 80,
  width: 180,
  height: 28,
  signerName: "Alex Example",
  deliveryEmail: "reviewer@example.invalid",
  pageWidth: 612,
  pageHeight: 792,
  pageCount: 37,
};

describe("signature placement", () => {
  it("blocks the fictional address and accepts a chosen box", () => {
    assert.equal(fictionalAddress("alex.example@test.invalid"), true);
    const blocked = placementPreview({ ...base, deliveryEmail: "alex.example@test.invalid" });
    assert.equal(blocked.ok, false);
    const missing = placementPreview({ ...base, width: 0, height: 0 });
    assert.equal(missing.ok, false);
    const preview = placementPreview(base);
    assert.equal(preview.ok, true);
    if (preview.ok) {
      assert.match(preview.preview, /LP257 6\/26/);
      assert.match(preview.preview, /page 3, x 40, y 80, width 180, height 28/);
      assert.match(preview.preview, /Nothing was sent/);
      assert.match(preview.preview, /Signed at \(city\).*was not used/);
    }
  });
});
