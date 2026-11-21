import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { attachPreviews, bindPreviewMessages, previewBoardHtml, previewCanSend, readChatPreviewRows, trayOffers } from "./chat-previews.ts";

const dir = await mkdtemp(join("/opt/ua-release/data", "chat-preview-test-"));
const pg = new PGlite(dir);
await pg.waitReady;
await pg.exec(`
  create table assistant_actions (
    id serial primary key,
    advisor_id integer not null,
    kind text not null,
    summary text not null,
    payload text not null,
    status text not null default 'pending'
  );
`);
const sql = { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => pg.query<T>(text, params).then((result) => result.rows) };

after(async () => {
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});

describe("each chat preview stays with its message", () => {
  it("does not allow send from a cancelled, revised, or preview-only row", () => {
    for (const status of ["discarded", "withdrawn", "cancelled", "stale", "done", "superseded"]) {
      assert.equal(previewCanSend({ status, kind: "newsletter" }), false);
    }
    assert.equal(previewCanSend({ status: "pending", kind: "newsletter-preview" }), false);
    assert.equal(previewCanSend({ status: "pending", kind: "newsletter" }), true);
    assert.equal(previewCanSend({ kind: "card" }), true);
    assert.equal(previewCanSend({ status: "pending", kind: "card", canSend: false }), false);
    assert.equal(previewCanSend({ status: "withdrawn", kind: "card", canSend: true }), false);
  });

  it("keeps both previews after a revision and refuses the other advisor", async () => {
    const first = await sql.query<{ id: number }>(
      "insert into assistant_actions (advisor_id, kind, summary, payload, status) values (1, 'newsletter', 'First', '{\"title\":\"One\"}', 'pending') returning id",
    );
    const second = await sql.query<{ id: number }>(
      "insert into assistant_actions (advisor_id, kind, summary, payload, status) values (1, 'newsletter', 'Second', '{\"title\":\"Two\"}', 'pending') returning id",
    );
    const foreign = await sql.query<{ id: number }>(
      "insert into assistant_actions (advisor_id, kind, summary, payload) values (2, 'newsletter', 'Other', '{\"title\":\"Other\"}') returning id",
    );
    await bindPreviewMessages(sql, 1, 10, 100, [Number(first[0].id)]);
    await sql.query("update assistant_actions set status = 'withdrawn' where id = $1 and advisor_id = 1", [first[0].id]);
    await bindPreviewMessages(sql, 1, 10, 101, [Number(second[0].id)]);
    await bindPreviewMessages(sql, 2, 10, 100, [Number(first[0].id)]);
    await bindPreviewMessages(sql, 1, 99, 500, [Number(foreign[0].id)]);
    await bindPreviewMessages(sql, 1, 10, 101, [Number(first[0].id)]);

    const own = await readChatPreviewRows(sql, 1, 10);
    const otherChat = await readChatPreviewRows(sql, 1, 99);
    const otherAdvisor = await readChatPreviewRows(sql, 2, 10);
    assert.equal(otherChat.length, 0);
    assert.equal(otherAdvisor.length, 0);
    assert.deepEqual(own.map((row) => [Number(row.message_id), String(row.summary), String(row.status)]), [
      [100, "First", "withdrawn"],
      [101, "Second", "pending"],
    ]);

    const shown = attachPreviews(
      [{ id: 100, role: "assistant", content: "First reply" }, { id: 101, role: "assistant", content: "Revised reply" }],
      own.map((row) => ({
        id: Number(row.id),
        messageId: Number(row.message_id),
        kind: String(row.kind),
        status: String(row.status),
        summary: String(row.summary),
      })),
    );
    assert.equal(shown[0].previews[0].summary, "First");
    assert.equal(shown[0].previews[0].canSend, false);
    assert.equal(shown[1].previews[0].summary, "Second");
    assert.equal(shown[1].previews[0].canSend, true);
    const untouched = await sql.query<{ message_id: number | null }>("select message_id from assistant_actions where id = $1", [foreign[0].id]);
    assert.equal(untouched[0].message_id, null);
  });

  it("ignores empty ids and will not move a preview that already belongs to a message", async () => {
    const row = await sql.query<{ id: number }>(
      "insert into assistant_actions (advisor_id, kind, summary, payload, status) values (3, 'card', 'Kept', '{\"title\":\"Kept\"}', 'pending') returning id",
    );
    const id = Number(row[0].id);
    await bindPreviewMessages(sql, 0, 30, 300, [id]);
    await bindPreviewMessages(sql, 3, 0, 300, [id]);
    await bindPreviewMessages(sql, 3, 30, 0, [id]);
    await bindPreviewMessages(sql, 3, 30, -4, [id]);
    await bindPreviewMessages(sql, 3, 30, 300, [0, -3]);
    const before = await sql.query<{ message_id: number | null }>("select message_id from assistant_actions where id = $1", [id]);
    assert.equal(before[0].message_id, null);

    await bindPreviewMessages(sql, 3, 30, 300, [id]);
    await bindPreviewMessages(sql, 3, 31, 301, [id]);
    await sql.query("update assistant_actions set status = 'withdrawn' where id = $1", [id]);
    const after = await sql.query<{ chat_id: number; message_id: number; status: string }>("select chat_id, message_id, status from assistant_actions where id = $1", [id]);
    assert.equal(Number(after[0].chat_id), 30);
    assert.equal(Number(after[0].message_id), 300);
    assert.equal(after[0].status, "withdrawn");

    const second = await sql.query<{ id: number }>(
      "insert into assistant_actions (advisor_id, kind, summary, payload, status) values (3, 'eletter', 'Also', '{\"title\":\"Also\"}', 'pending') returning id",
    );
    await bindPreviewMessages(sql, 3, 30, 300, [Number(second[0].id)]);
    const pair = await readChatPreviewRows(sql, 3, 30);
    assert.deepEqual(pair.map((item) => Number(item.message_id)), [300, 300]);
    const other = await readChatPreviewRows(sql, 4, 30);
    const elsewhere = await readChatPreviewRows(sql, 3, 31);
    assert.equal(other.length, 0);
    assert.equal(elsewhere.length, 0);

    const shown = attachPreviews(
      [{ id: 300 }, { id: 301 }, { id: 0 }],
      [
        { id, messageId: 300, kind: "card", status: "withdrawn", summary: "Kept" },
        { id: Number(second[0].id), messageId: 300, kind: "eletter", status: "pending", summary: "Also" },
        { id: 9, messageId: 0, kind: "card", status: "pending", summary: "Loose" },
        { id: 8, messageId: -1, kind: "card", status: "pending", summary: "Negative" },
      ],
    );
    assert.equal(shown[0].previews.length, 2);
    assert.equal(shown[0].previews[0].canSend, false);
    assert.equal(shown[0].previews[1].canSend, true);
    assert.equal(shown[1].previews.length, 0);
    assert.equal(shown[2].previews.length, 0);
  });

  it("keeps a historical preview visible and out of the send tray", () => {
    const turns = [
      { id: 100, content: "First reply", previews: [{ id: 4, kind: "card", summary: "Birthday · Jordan Example", status: "withdrawn" }] },
      { id: 101, content: "Revised reply", previews: [{ id: 5, kind: "card", summary: "Birthday · Quinn Sample", status: "pending" }] },
    ];
    const tray = [
      { id: 4, kind: "card", summary: "Birthday · Jordan Example", status: "withdrawn" },
      { id: 5, kind: "card", summary: "Birthday · Quinn Sample", status: "pending" },
      { id: 6, kind: "card-preview", summary: "Sample only", status: "pending" },
      { id: 7, kind: "newsletter", summary: "Unlinked letter", status: "pending" },
      { id: 8, kind: "card", summary: "Forced off", status: "pending", canSend: false },
    ];
    assert.equal(trayOffers(tray[0], [4, 5]), false);
    assert.equal(trayOffers(tray[1], new Set([4, 5])), false);
    assert.equal(trayOffers(tray[2], []), false);
    assert.equal(trayOffers(tray[3], []), true);
    assert.equal(trayOffers(tray[4], []), false);
    const html = previewBoardHtml({ turns, tray });
    const firstArticle = html.match(/<article[^>]*data-preview-id="4"[^>]*>[\s\S]*?<\/article>/)?.[0] || "";
    const secondArticle = html.match(/<article[^>]*data-preview-id="5"[^>]*>[\s\S]*?<\/article>/)?.[0] || "";
    assert.match(firstArticle, /data-can-send="no"/);
    assert.match(firstArticle, /Earlier preview kept with this message\. Nothing can be sent from it\./);
    assert.doesNotMatch(firstArticle, /Approve/);
    assert.match(secondArticle, /data-can-send="yes"/);
    assert.match(secondArticle, /Approve and send/);
    const offered = html.split("data-preview-tray")[1] || "";
    assert.doesNotMatch(offered, /data-preview-id="4"/);
    assert.doesNotMatch(offered, /data-preview-id="5"/);
    assert.doesNotMatch(offered, /data-preview-id="6"/);
    assert.doesNotMatch(offered, /data-preview-id="8"/);
    assert.match(offered, /data-preview-id="7" data-can-send="yes"/);
  });
});
