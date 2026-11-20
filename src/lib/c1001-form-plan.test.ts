import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fictionalClients } from "./desk-workflows.ts";
import { planC1001Fill } from "./c1001-form-plan.ts";

describe("C-1001 form plan", () => {
  it("fills only the name and province and leaves conflicts blank", () => {
    const files = fictionalClients("4").filter((file) => file.clientId === "C-1001");
    const plan = planC1001Fill(files);
    const filled = plan.filter((line) => line.status === "filled");
    assert.deepEqual(filled.map((line) => [line.label, line.value]), [
      ["First name", "Alex"],
      ["Last name", "Example"],
      ["Province", "Ontario"],
    ]);
    const city = plan.find((line) => line.label === "City");
    assert.equal(city?.status, "left blank");
    assert.match(city?.source || "", /Toronto/);
    assert.match(city?.source || "", /Hamilton/);
    const policy = plan.find((line) => line.label === "Policy number");
    assert.equal(policy?.status, "left blank");
    assert.match(policy?.source || "", /POL-1001/);
    assert.match(policy?.source || "", /not mapped/);
    assert.equal(plan.find((line) => line.label === "Signature")?.status, "left blank");
  });
});
