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
page.setDefaultTimeout(45000);
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

  async function ask(text) {
    const bubbles = page.locator(".ua-assist-log > div");
    const before = await bubbles.count();
    await page.locator("#ai-assistant-input").fill(text);
    await page.locator("form.ua-assist-compose button[type=submit]").click();
    await page.waitForFunction((count) => {
      const log = document.querySelector(".ua-assist-log");
      if (!log || log.children.length <= count) return false;
      return !/Working…/.test(document.body.innerText);
    }, before);
    const texts = await bubbles.allInnerTexts();
    return texts.slice(before).join("\n");
  }

  const casey = await ask("Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.");
  note("saved-read", /casey\.sample@example\.invalid/i.test(casey), "Casey email read back before other work");

  const both = await ask("Send the Thank You card to Casey Sample and Riley Sample");
  note("card-both", /Just to confirm:/i.test(both) && /Casey Sample/.test(both) && /Riley Sample/.test(both) && !/Casey Sample or Riley Sample/.test(both) && /Nothing was sent/i.test(both), "one approval preview for both");
  note("card-both-not-sent", !/is on its way/i.test(both), "no delivery sentence");

  const avery = await ask("Preview the Thank You card for Avery Sample only. Show the recipient email or explain if it is missing. Do not send.");
  note("avery", /Avery Sample/.test(avery) && /no email saved/i.test(avery) && /Nothing was sent/i.test(avery), avery.replace(/\s+/g, " ").slice(0, 240));

  const farsi = await ask("کارت تولد را برای جردن بفرست. لغو. آن را برای کوین بفرست.");
  note("farsi-cancel", /Quinn Sample/.test(farsi) && /Unsubscribed/i.test(farsi) && /Jordan Example/.test(farsi) && /Nothing was sent/i.test(farsi), "later recipient kept and blocked");

  const news = await ask("Send a newsletter about life insurance to Casey Sample and Riley Sample.");
  note("newsletter", /Just to confirm:/i.test(news) && /Casey Sample/.test(news) && /Riley Sample/.test(news) && !/Casey Sample or Riley Sample/.test(news) && /Nothing was sent|Say yes to send/i.test(news), "newsletter preview for both");

  const letter = await ask("Write a letter to Casey Sample and Riley Sample and tell them the annual review is ready.");
  note("letter", /Just to confirm:/i.test(letter) && /Casey Sample/.test(letter) && /Riley Sample/.test(letter) && /Nothing was sent|Say yes|has not been sent/i.test(letter), letter.replace(/\s+/g, " ").slice(0, 240));

  const drip = await ask("Start the Acceptance — Welcome Drip for Casey Sample and Riley Sample.");
  note("drip", /Just to confirm:/i.test(drip) && /Casey Sample/.test(drip) && /Riley Sample/.test(drip) && /Nothing was sent|Nothing was started|has not started/i.test(drip), drip.replace(/\s+/g, " ").slice(0, 240));

  await page.locator(".ua-assist-log").evaluate((node) => { node.scrollTop = 0; });
  const scrolled = await page.locator(".ua-assist-log").innerText();
  note("scroll-back", /Thank You/.test(scrolled) && /Avery Sample/.test(scrolled) && /life insurance/i.test(scrolled), "earlier messages still in the log");

  const previewCount = await page.locator(".ua-mail-preview").count();
  const sendable = await page.locator(".ua-mail-preview[data-can-send=yes]").count();
  const historical = await page.locator(".ua-mail-preview[data-can-send=no]").count();
  note("preview-split", previewCount >= 4 && historical >= 1, `${previewCount} previews, ${historical} not sendable, ${sendable} still sendable`);

  const workflowTitle = (await page.locator(".ua-assist-row.on .title .name").innerText()).replace(/\s+/g, " ").trim();
  await page.locator("#ai-assistant-chat").getByRole("button", { name: "New chat" }).click();
  await page.waitForTimeout(500);
  await page.locator(".ua-assist-row").filter({ has: page.locator(".title .name", { hasText: workflowTitle }) }).first().locator("button.title").click();
  await page.locator(".ua-mail-preview").first().waitFor();
  const reopened = await page.locator(".ua-assist-log").innerText();
  note("reopen", /Casey Sample/.test(reopened) && /Riley Sample/.test(reopened) && /Avery Sample/.test(reopened), "previous chat restored its messages");

  await page.reload({ waitUntil: "domcontentloaded" });
  await assistantButton().click();
  await page.locator(".ua-assist-row").filter({ has: page.locator(".title .name", { hasText: workflowTitle }) }).first().locator("button.title").click();
  await page.locator(".ua-mail-preview").first().waitFor();
  const refreshed = await page.locator(".ua-assist-log").innerText();
  note("refresh", /Thank You/.test(refreshed) && /Avery Sample/.test(refreshed), "refresh kept the message previews");
  const oldButtons = await page.locator(".ua-mail-preview[data-can-send=no] button", { hasText: "Approve and send" }).count();
  note("historical-approval", oldButtons === 0, "older previews have no send button");

  await page.locator("#ai-assistant-chat").getByRole("button", { name: "New chat" }).click();
  await page.locator("#ai-assistant-input").waitFor();
  const asked = await ask("Send a birthday card to Jordan Example");
  let identity = asked;
  if (/did you mean/i.test(asked)) identity = await ask("Yes");
  note("identity-yes", /Just to confirm:/i.test(identity) && /Jordan Example/.test(identity) && !/no longer valid/i.test(identity), "yes after a card question prepared a preview");
  const stale = await ask("Yes");
  note("stale-yes", /no longer valid|already heard|did not send|nothing was sent/i.test(stale) && !/is on its way/i.test(stale), stale.replace(/\s+/g, " ").slice(0, 240));

  const again = await ask("Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.");
  note("saved-unchanged", /casey\.sample@example\.invalid/i.test(again) && !/Morgan Sample/.test(again), "Casey record still reads back and Morgan was not pulled in");

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
