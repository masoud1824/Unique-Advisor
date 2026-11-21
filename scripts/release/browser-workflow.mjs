#!/usr/bin/env node
/**
 * Isolated browser workflow against the staging desk only.
 * This is not a unit test. It does not open port 8080 or the acceptance database.
 * The access code is read from disk and never written to the log.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.UA_BROWSER_BASE || "http://127.0.0.1:8093";
if (!base.includes("8093")) throw new Error("Browser workflow refuses any base other than the staging port.");
const outDir = "/opt/ua-release/artifacts/browser-workflow";
const logPath = "/opt/ua-release/logs/browser-workflow.log";
await mkdir(outDir, { recursive: true });
const accessFile = await readFile("/opt/ua-release/run/staging-access.txt", "utf8");
const access = accessFile.match(/^advisor-code:\s*(\S+)/m)?.[1]?.trim() || "";
const slug = accessFile.match(/^advisor-slug:\s*(\S+)/m)?.[1]?.trim() || "";
if (!access || access.length < 4 || !slug) throw new Error("Staging access file is missing a code or slug.");

const findings = [];
function note(name, ok, detail) {
  findings.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(90000);
try {
  const assistantButton = () => page.getByRole("main").getByRole("button", { name: "AI assistant" });
  await page.goto(`${base}/a/${slug}/desk`, { waitUntil: "domcontentloaded" });
  await page.locator("input[name=access]").waitFor({ timeout: 20000 });
  await page.locator("input[name=access]").fill(access);
  await page.getByRole("button", { name: "Open desk" }).click();
  await assistantButton().waitFor();
  note("login", true, "desk opened");
  await assistantButton().click();
  await page.locator("#ai-assistant-input").waitFor();
  await page.locator("#ai-assistant-chat").getByRole("button", { name: "New chat", exact: true }).click();
  await page.waitForFunction(() => {
    const log = document.querySelector(".ua-assist-log");
    if (!log) return false;
    const text = log.textContent || "";
    const busy = [...document.querySelectorAll("button")].some((button) => (button.textContent || "").includes("Working"));
    return !busy && text.includes("Ask who needs a call") && !text.includes("Birthday Wishes");
  });

  async function ask(text) {
    const bubbles = page.locator(".ua-assist-log > div");
    const before = await bubbles.count();
    const needle = text.slice(0, 48);
    await page.locator("#ai-assistant-input").fill(text);
    await page.locator("form.ua-assist-compose button[type=submit]").click();
    await page.waitForFunction(({ count, needle: asked }) => {
      const log = document.querySelector(".ua-assist-log");
      if (!log || log.children.length <= count) return false;
      const added = [...log.children].slice(count).map((node) => node.textContent || "").join("\n");
      if (!added.includes(asked)) return false;
      const busy = [...document.querySelectorAll("button")].some((button) => (button.textContent || "").includes("Working"));
      return !busy && added.length > asked.length + 12;
    }, { count: before, needle });
    const texts = await bubbles.allInnerTexts();
    return texts.slice(before).join("\n");
  }

  async function contactsText() {
    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    const table = page.getByRole("main").locator("table").first();
    await table.waitFor();
    const text = (await table.innerText()).replace(/\s+/g, " ").trim();
    await page.getByRole("button", { name: "AI assistant", exact: true }).first().click();
    await page.locator("#ai-assistant-input").waitFor();
    return text;
  }

  async function fingerprints() {
    return page.locator(".ua-mail-preview").evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute("data-preview-id") || "",
      send: node.getAttribute("data-can-send") || "",
      status: node.getAttribute("data-preview-status") || "",
      summary: (node.querySelector("p.font-semibold")?.textContent || "").replace(/\s+/g, " ").trim(),
    })));
  }

  function samePreviews(left, right) {
    const key = (row) => `${row.id}|${row.send}|${row.status}|${row.summary}`;
    return JSON.stringify(left.map(key).sort()) === JSON.stringify(right.map(key).sort());
  }

  const contactsBefore = await contactsText();
  note("contacts-before", /Casey Sample/.test(contactsBefore) && /casey\.sample@example\.invalid/i.test(contactsBefore) && /Morgan Sample/.test(contactsBefore) && /Avery Sample/.test(contactsBefore), contactsBefore.slice(0, 500));

  const casey = await ask("Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.");
  note("saved-read", /casey\.sample@example\.invalid/i.test(casey), casey.replace(/\s+/g, " ").slice(0, 500));

  const both = await ask("Send the Thank You card to Casey Sample and Riley Sample");
  note("card-both", /Just to confirm:/i.test(both) && /Casey Sample/.test(both) && /Riley Sample/.test(both) && !/Casey Sample or Riley Sample/.test(both) && /Nothing was sent/i.test(both) && !/is on its way/i.test(both), both.replace(/\s+/g, " ").slice(0, 800));

  const avery = await ask("Preview the Thank You card for Avery Sample only. Show the recipient email or explain if it is missing. Do not send.");
  note("avery", /Avery Sample/.test(avery) && /no email saved/i.test(avery) && /Nothing was sent/i.test(avery) && !/is on its way/i.test(avery), avery.replace(/\s+/g, " ").slice(0, 800));

  const farsi = await ask("کارت تولد را برای جردن بفرست. لغو. آن را برای کوین بفرست.");
  note("farsi-cancel", /Quinn Sample/.test(farsi) && /Unsubscribed/i.test(farsi) && /Jordan Example/.test(farsi) && /Nothing was sent/i.test(farsi) && !/is on its way/i.test(farsi), farsi.replace(/\s+/g, " ").slice(0, 800));

  const news = await ask("Send a newsletter about life insurance to Casey Sample and Riley Sample.");
  note("newsletter", /Just to confirm:/i.test(news) && /Casey Sample/.test(news) && /Riley Sample/.test(news) && !/Casey Sample or Riley Sample/.test(news) && /Nothing was sent|Say yes to send/i.test(news) && !/is on its way/i.test(news), news.replace(/\s+/g, " ").slice(0, 800));

  const letter = await ask("Write a letter to Casey Sample and Riley Sample and tell them the annual review is ready.");
  note("letter", /Just to confirm:/i.test(letter) && /Casey Sample/.test(letter) && /Riley Sample/.test(letter) && /Nothing was sent|Say yes|has not been sent/i.test(letter) && !/is on its way/i.test(letter), letter.replace(/\s+/g, " ").slice(0, 800));

  const drip = await ask("Start the Acceptance — Welcome Drip for Casey Sample and Riley Sample.");
  note("drip", /Just to confirm:/i.test(drip) && /Casey Sample/.test(drip) && /Riley Sample/.test(drip) && /Nothing was sent|Nothing was started|has not started/i.test(drip) && !/is on its way/i.test(drip), drip.replace(/\s+/g, " ").slice(0, 800));

  const expected = await fingerprints();
  const thankYouRow = expected.filter((row) => /Thank You/i.test(row.summary) && /Casey Sample/.test(row.summary) && /Riley Sample/.test(row.summary));
  note("preview-each", expected.length >= 4 && thankYouRow.some((row) => row.send === "yes" && row.status === "pending") && expected.some((row) => /newsletter|life insurance/i.test(row.summary) && row.send === "yes") && expected.some((row) => /annual review/i.test(row.summary) && row.send === "yes") && expected.some((row) => /Welcome Drip/i.test(row.summary) && row.send === "yes") && expected.some((row) => /Avery Sample/.test(row.summary)), JSON.stringify(expected));

  await page.locator(".ua-assist-log").evaluate((node) => { node.scrollTop = 0; });
  const scrolled = await page.locator(".ua-assist-log").innerText();
  const afterScroll = await fingerprints();
  note("scroll-back", /Thank You/.test(scrolled) && /Avery Sample/.test(scrolled) && /life insurance/i.test(scrolled) && /annual review/i.test(scrolled) && /Welcome Drip/.test(scrolled) && samePreviews(expected, afterScroll), "every preview id stayed after scrolling");

  const workflowTitle = (await page.locator(".ua-assist-row.on .title .name").innerText()).replace(/\s+/g, " ").trim();
  await page.locator("#ai-assistant-chat").getByRole("button", { name: "New chat" }).click();
  await page.waitForTimeout(500);
  await page.locator(".ua-assist-row").filter({ has: page.locator(".title .name", { hasText: workflowTitle }) }).first().locator("button.title").click();
  await page.locator(".ua-mail-preview").first().waitFor();
  const reopened = await page.locator(".ua-assist-log").innerText();
  const afterReopen = await fingerprints();
  note("reopen", /Casey Sample/.test(reopened) && /Riley Sample/.test(reopened) && /Avery Sample/.test(reopened) && /annual review/i.test(reopened) && /Welcome Drip/.test(reopened) && samePreviews(expected, afterReopen), "every preview id was restored with the same send flag");

  await page.reload({ waitUntil: "domcontentloaded" });
  await assistantButton().click();
  await page.locator(".ua-assist-row").filter({ has: page.locator(".title .name", { hasText: workflowTitle }) }).first().locator("button.title").click();
  await page.locator(".ua-mail-preview").first().waitFor();
  const refreshed = await page.locator(".ua-assist-log").innerText();
  const afterRefresh = await fingerprints();
  note("refresh", /Thank You/.test(refreshed) && /Avery Sample/.test(refreshed) && /life insurance/i.test(refreshed) && /annual review/i.test(refreshed) && /Welcome Drip/.test(refreshed) && samePreviews(expected, afterRefresh), "refresh kept every message preview");
  const oldButtons = await page.locator(".ua-mail-preview[data-can-send=no] button", { hasText: "Approve and send" }).count();
  note("historical-approval", oldButtons === 0, "non-sendable previews have no send button");

  const thankYou = page.locator(".ua-mail-preview[data-can-send=yes]").filter({ hasText: "Thank You" }).filter({ hasText: "Casey Sample" }).filter({ hasText: "Riley Sample" }).last();
  const thankYouId = await thankYou.getAttribute("data-preview-id");
  note("thank-you-still-valid", Boolean(thankYouId) && (await thankYou.getAttribute("data-can-send")) === "yes" && (await thankYou.getAttribute("data-preview-status")) === "pending", `Thank You preview ${thankYouId} stayed pending`);
  await thankYou.getByRole("button", { name: "Discard" }).click();
  await page.locator(`.ua-mail-preview[data-preview-id="${thankYouId}"][data-can-send=no]`).waitFor();

  const kept = page.locator(".ua-mail-preview[data-can-send=yes]").first();
  const keptId = await kept.getAttribute("data-preview-id");
  const [liveResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().headers()["x-tsr-serverfn"] === "true" && response.request().method() === "POST"),
    kept.getByRole("button", { name: /Approve and send|Run the campaign/ }).click(),
  ]);
  const liveBody = await liveResponse.text();
  note("valid-pending-blocked", /Nothing was sent/i.test(liveBody) && !/is on its way/i.test(liveBody) && !/already handled/i.test(liveBody), "a still-valid pending action was blocked by the mock provider and was not treated as historical");
  const keptAfter = await page.locator(`.ua-mail-preview[data-preview-id="${keptId}"]`).getAttribute("data-can-send");
  note("valid-pending-remains", keptAfter === "yes", `preview ${keptId} is still sendable`);

  const posted = liveResponse.request().postData() || "";
  let parsed;
  try { parsed = JSON.parse(posted); }
  catch { throw new Error("The approval request was not JSON."); }
  const hits = [];
  const visit = (value, path, parentKey) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`, parentKey));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`, key);
      return;
    }
    if (String(value) === String(keptId)) hits.push({ path, parentKey });
  };
  visit(parsed, "$", "");
  const chosen = hits.filter((hit) => hit.parentKey === "actionId" || hit.path.includes("actionId"));
  const targets = chosen.length ? chosen : hits.length === 1 ? hits : [];
  if (targets.length !== 1) {
    const outline = [];
    const sketch = (value, path) => {
      if (Array.isArray(value)) {
        outline.push(`${path}[]${value.length}`);
        value.forEach((child, index) => sketch(child, `${path}[${index}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === "string") outline.push(`${path}.${key}:str${child.length}`);
          else if (typeof child === "number") outline.push(`${path}.${key}:num`);
          else sketch(child, `${path}.${key}`);
        }
        return;
      }
      outline.push(`${path}:${typeof value}`);
    };
    sketch(parsed, "$");
    throw new Error(`The approval request did not expose one action id (${targets.length} targets, ${hits.length} id hits). ${outline.join(" ").slice(0, 500)}`);
  }
  const assign = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        const here = `${path}[${index}]`;
        if (here === targets[0].path) value[index] = Number(thankYouId);
        else assign(child, here);
      });
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const here = `${path}.${key}`;
        if (here === targets[0].path) value[key] = Number(thankYouId);
        else assign(child, here);
      }
    }
  };
  assign(parsed, "$");
  const incoming = liveResponse.request().headers();
  const headers = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "cookie" || key === "content-length" || key === "host") continue;
    headers[key] = value;
  }
  headers["x-tsr-serverfn"] = "true";
  const historicalResponse = await page.request.post(liveResponse.request().url(), { headers, data: parsed });
  const historicalBody = await historicalResponse.text();
  note("historical-server-reject", /already handled|no longer valid/i.test(historicalBody) && /Nothing was sent/i.test(historicalBody) && !/is on its way/i.test(historicalBody), historicalBody.replace(/\s+/g, " ").slice(0, 400));

  await page.locator("#ai-assistant-chat").getByRole("button", { name: "New chat" }).click();
  await page.locator("#ai-assistant-input").waitFor();
  const asked = await ask("Send a birthday card to Jordan Example");
  let identity = asked;
  if (/did you mean/i.test(asked)) identity = await ask("Yes");
  note("identity-yes", /Just to confirm:/i.test(identity) && /Jordan Example/.test(identity) && !/no longer valid/i.test(identity) && !/is on its way/i.test(identity), identity.replace(/\s+/g, " ").slice(0, 800));
  const stale = await ask("Yes");
  note("current-yes", /Nothing was sent/i.test(stale) && !/is on its way/i.test(stale) && !/More than one action is waiting/i.test(stale), stale.replace(/\s+/g, " ").slice(0, 800));

  const again = await ask("Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.");
  note("saved-unchanged", /casey\.sample@example\.invalid/i.test(again) && !/Morgan Sample/.test(again), again.replace(/\s+/g, " ").slice(0, 500));
  const contactsAfter = await contactsText();
  note("contacts-after", contactsAfter === contactsBefore, contactsAfter === contactsBefore ? "contact table unchanged" : `before ${contactsBefore.slice(0, 240)} after ${contactsAfter.slice(0, 240)}`);

  await page.screenshot({ path: `${outDir}/workflow.png`, fullPage: true });
} catch (error) {
  note("browser-run", false, error instanceof Error ? error.message : "failed");
  try { await page.screenshot({ path: `${outDir}/failure.png`, fullPage: true }); } catch { /* no page */ }
} finally {
  await browser.close();
}
const failed = findings.filter((item) => !item.ok);
const report = { at: new Date().toISOString(), base, browser: "playwright-chromium", unitTests: false, failed: failed.length, findings };
await writeFile(logPath, `${JSON.stringify(report, null, 2)}\n`);
if (failed.length) process.exit(1);
