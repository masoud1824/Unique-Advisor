import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { previewBoardHtml } from "./chat-previews.ts";

const deskSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/assistant-desk.tsx"), "utf8");

const turns = [
  { id: 100, content: "First reply", previews: [{ id: 4, kind: "card", summary: "Birthday · Jordan Example", status: "withdrawn" }] },
  { id: 101, content: "Revised reply", previews: [{ id: 5, kind: "card", summary: "Birthday · Quinn Sample", status: "pending" }] },
];
const tray = [
  { id: 4, kind: "card", summary: "Birthday · Jordan Example", status: "withdrawn" },
  { id: 5, kind: "card", summary: "Birthday · Quinn Sample", status: "pending" },
  { id: 6, kind: "card-preview", summary: "Sample only", status: "pending" },
  { id: 7, kind: "newsletter", summary: "Unlinked letter", status: "pending" },
];

describe("per-message preview board", () => {
  it("uses the same send rule in the desk and keeps a withdrawn preview from being approved", async () => {
    assert.match(deskSource, /previewCanSend/);
    assert.match(deskSource, /trayOffers/);
    assert.match(deskSource, /data-can-send=\{sendable \? "yes" : "no"\}/);
    assert.match(deskSource, /Earlier preview kept with this message\. Nothing can be sent from it\./);

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage();
      await page.setContent(previewBoardHtml({ turns, tray }));
      const first = page.locator("[data-preview-id='4']");
      const second = page.locator("[data-message-id='101'] [data-preview-id='5']");
      assert.equal(await first.getAttribute("data-can-send"), "no");
      assert.equal(await first.getAttribute("data-preview-status"), "withdrawn");
      assert.match(await first.innerText(), /Earlier preview kept with this message\. Nothing can be sent from it\./);
      assert.equal(await first.getByRole("button", { name: /Approve/ }).count(), 0);
      assert.equal(await second.getAttribute("data-can-send"), "yes");
      assert.equal(await second.getByRole("button", { name: "Approve and send" }).count(), 1);
      const offered = await page.locator("[data-preview-tray] article").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-preview-id")));
      assert.deepEqual(offered, ["7"]);
      assert.equal(await page.locator("[data-message-id='100']").count(), 1);
      assert.equal(await page.locator("[data-message-id='101']").count(), 1);
    } finally {
      await browser.close();
    }
  });
});
