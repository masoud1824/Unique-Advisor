import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["/opt/pw-browsers/chromium-1248/chrome-linux64/chrome"].find((path) => existsSync(path));
const playwright = [
  resolve(root, "node_modules/playwright-core/index.js"),
  "/opt/ua-release/repos/staging/node_modules/playwright-core/index.js",
].find((path) => existsSync(path));
const css = readFileSync(resolve(root, "src/styles.css"), "utf8").replace(/^@import[^\n]*\n/, "");
const hostile = `
[hidden] { display: none !important; }
@media (min-width: 768px) {
  .md\\:fixed { position: fixed; }
  .md\\:inset-y-0 { top: 0; bottom: 0; }
  .md\\:flex { display: flex; }
  .md\\:flex-col { flex-direction: column; }
  .md\\:w-\\[260px\\] { width: 260px; }
  .md\\:ml-\\[260px\\] { margin-left: 260px; }
  .md\\:px-10 { padding-left: 2.5rem; padding-right: 2.5rem; }
  .md\\:py-8 { padding-top: 2rem; padding-bottom: 2rem; }
}
.px-5 { padding-left: 1.25rem; padding-right: 1.25rem; }
.py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }
.p-6 { padding: 1.5rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-7 { margin-bottom: 1.75rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.sticky { position: sticky; top: 0; }
#workspace:not([hidden]) { display: contents; }
`;
const voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];

function shell() {
  return `<!doctype html><style>${css}${hostile}</style>
    <div class="ua-practice-shell" id="shell">
      <div data-practice-banner style="padding:10px 16px;text-align:center;background:#8a3a12;color:#fff">Staging practice. Outbound mail is blocked.</div>
      <div class="ua-desk" id="desk">
        <aside class="ua-side ua-assistant-nav md:fixed md:inset-y-0 md:flex md:flex-col md:w-[260px]">
          <div class="ua-logo" style="padding:12px;background:#fff;margin:16px">Unique Advisor</div>
          <nav class="ua-nav">
            <button type="button" class="ua-navbtn" id="open-assistant">AI assistant</button>
            <button type="button" class="ua-navbtn">Contacts</button>
            <button type="button" class="ua-navbtn">Dashboard</button>
          </nav>
        </aside>
        <main class="ua-assistant-main md:ml-[260px] px-5 py-6 md:px-10 md:py-8" id="main">
          <div id="other-page">
            <div class="ua-desk-toolbar sticky">AI assistant</div>
            <section class="ua-panel p-6 mb-4">Install the desk on your phone. ${"Add it to the home screen. ".repeat(8)}</section>
            <div class="ua-desk-heading mb-7"><h1 class="text-3xl">Dashboard</h1><span>Professional</span><button type="button">Upgrade Plan</button></div>
            <section class="ua-panel p-6 mb-4">Signature workflow preview. ${"Nothing is sent. ".repeat(30)}</section>
            <section class="ua-panel p-6 mb-4">Document email preview. ${"Nothing is sent. ".repeat(30)}</section>
          </div>
          <div id="workspace" hidden>
            <header class="ua-workspace-bar">
              <h1>AI assistant</h1>
              <span class="ua-plan-pill">Professional</span>
              <div class="ua-install-phone"><button type="button" id="install">Install the desk</button></div>
              <button type="button" id="signature">Signature preview</button>
              <button type="button" id="mail">Document email</button>
            </header>
            <section class="ua-ribbon" dir="ltr" lang="en">
              <div class="ua-ribbon-bar">
                <div class="ua-ribbon-viewport" data-ticker-viewport>
                  <div class="ua-ribbon-track" data-ticker-track><a class="ua-ribbon-item" href="https://example.invalid/rates">Rates</a></div>
                </div>
                <div class="ua-ribbon-tools"><button type="button" id="pause">Pause</button></div>
              </div>
            </section>
            <div class="ua-assist-stage">
              <section class="ua-panel ua-assist-panel">
                <div class="ua-assist-tools">
                  <button type="button" id="history">History</button>
                  <button type="button" id="new-chat" data-new-chat>New chat</button>
                  <button type="button">Rules</button>
                  <span class="ua-live-state" data-assistant-state>Listening</span>
                </div>
                <div class="ua-assist history-open" id="assist">
                  <aside class="ua-assist-list" id="history-side"><p class="ua-assist-head">Previous chats</p><div class="ua-assist-chats">${Array.from({ length: 12 }, (_, index) => `<p>Chat ${index}</p>`).join("")}</div></aside>
                  <div class="ua-assist-talk">
                    <div class="ua-log-wrap">
                      <div class="ua-assist-log" id="log">${Array.from({ length: 24 }, (_, index) => `<p>Message ${index} stays in the history. ${"This line is part of a long reply that must scroll inside the conversation. ".repeat(6)}</p>`).join("")}</div>
                      <button type="button" class="ua-btn ua-jump-latest" data-jump-latest>Latest</button>
                    </div>
                    <form class="ua-assist-compose" data-command-bar>
                      <p class="ua-playback-note">Spoken with this browser's English voice. This is not the selected OpenAI voice.</p>
                      <button type="button" id="voice-chooser" data-voice-chooser>Voice: coral</button>
                      <textarea class="ua-field" id="ai-assistant-input" rows="2">${"Ask the AI assistant about a long client note. ".repeat(12)}</textarea>
                      <div class="ua-command-row">
                        <button type="button" data-play-reply>Play reply</button>
                        <button type="button" class="ua-btn ua-voice-command" id="voice-command" data-voice-command>Voice command</button>
                        <button type="submit" class="ua-btn ua-ask" id="ask" data-ask>Ask</button>
                        <button type="button" class="ua-btn-line" id="review">Review clients</button>
                      </div>
                    </form>
                  </div>
                </div>
              </section>
            </div>
          </div>
          <div class="ua-modal" id="voice-modal" hidden>
            <div class="ua-voice-dialog" role="dialog" aria-label="Assistant voice">
              <div class="ua-voice-dialog-bar"><h2>Assistant voice</h2><button type="button" id="voice-close" data-voice-close>Close</button></div>
              <p class="ua-voice-note">Neutral North American English. This is not a labelled accent.</p>
              <div class="ua-voice-list" id="voices">
                ${voices.map((voice) => `<div class="ua-voice-row" data-voice="${voice}"><span class="ua-voice-name">${voice}</span><button type="button" class="ua-voice-preview">Preview</button><button type="button" class="ua-voice-use" data-action="use">Use</button></div>`).join("")}
              </div>
            </div>
          </div>
          <div class="ua-modal" id="draft-modal" hidden>
            <div class="ua-context-drawer" role="dialog" aria-label="Signature workflow preview">
              <button type="button" id="draft-close">Close</button>
              <div class="ua-context-body"><section class="ua-panel p-6">Signature workflow preview. ${"Nothing is sent. ".repeat(40)}</section></div>
            </div>
          </div>
        </main>
      </div>
    </div>
    <script>
      const desk = document.getElementById("desk");
      const other = document.getElementById("other-page");
      const workspace = document.getElementById("workspace");
      const assist = document.getElementById("assist");
      const side = document.getElementById("history-side");
      function openAssistant() {
        other.hidden = true;
        workspace.hidden = false;
        desk.classList.add("ua-assistant-lock");
        if (window.innerWidth < 900) {
          assist.classList.remove("history-open");
          side.hidden = true;
        }
      }
      document.getElementById("open-assistant").addEventListener("click", openAssistant);
      document.getElementById("voice-chooser").addEventListener("click", () => { document.getElementById("voice-modal").hidden = false; });
      document.getElementById("voice-close").addEventListener("click", () => { document.getElementById("voice-modal").hidden = true; document.getElementById("voice-chooser").focus(); });
      document.getElementById("signature").addEventListener("click", () => { document.getElementById("draft-modal").hidden = false; });
      document.getElementById("draft-close").addEventListener("click", () => { document.getElementById("draft-modal").hidden = true; document.getElementById("signature").focus(); });
    </script>`;
}

describe("assistant workspace", { skip: !chrome || !playwright }, () => {
  it("fills the desk viewport and keeps the command bar visible without forced scrolling", async () => {
    const require = createRequire(import.meta.url);
    const { chromium } = require(playwright);
    mkdirSync("/tmp/ua-shots", { recursive: true });
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const sizes = [
      { label: "1366x768", width: 1366, height: 768, zoom: 1, visual: 0, minLog: 260 },
      { label: "1280x640", width: 1280, height: 640, zoom: 1, visual: 0, minLog: 140 },
      { label: "390x700", width: 390, height: 700, zoom: 1, visual: 0, minLog: 120 },
      { label: "keyboard", width: 390, height: 700, zoom: 1, visual: 430, minLog: 40 },
      { label: "zoom125", width: 1366, height: 768, zoom: 1.25, visual: 0, minLog: 80 },
      { label: "zoom150", width: 1366, height: 768, zoom: 1.5, visual: 0, minLog: 48 },
    ];
    try {
      for (const size of sizes) {
        const page = await browser.newPage();
        await page.setViewportSize({ width: Math.round(size.width / size.zoom), height: Math.round(size.height / size.zoom) });
        await page.setContent(shell());
        if (size.visual) await page.evaluate((visual) => document.documentElement.style.setProperty("--ua-vvh", `${visual}px`), size.visual);
        await page.evaluate(() => document.getElementById("open-assistant").click());
        const measured = await page.evaluate(({ minLog, visual }) => {
          const limit = visual || window.visualViewport?.height || window.innerHeight;
          const box = (node) => node.getBoundingClientRect();
          const seen = (node) => {
            const rect = box(node);
            const x = Math.min(window.innerWidth - 2, Math.max(1, rect.left + Math.min(rect.width / 2, 24)));
            const y = Math.min(limit - 2, Math.max(1, rect.top + Math.min(rect.height / 2, 12)));
            const hit = document.elementFromPoint(x, y);
            return {
              inView: rect.height > 8 && rect.top >= -1 && rect.bottom <= limit + 1,
              clickable: Boolean(hit && (hit === node || node.contains(hit))),
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
            };
          };
          const log = document.getElementById("log");
          const compose = document.querySelector(".ua-assist-compose");
          const root = document.scrollingElement || document.documentElement;
          const input = document.getElementById("ai-assistant-input");
          const history = document.getElementById("history-side");
          return {
            limit,
            logHeight: log.clientHeight,
            logScroll: log.scrollHeight,
            logScrolls: log.scrollHeight > log.clientHeight + 4,
            pageScrolls: root.scrollHeight > window.innerHeight + 2 || root.scrollTop !== 0,
            composeOverflow: getComputedStyle(compose).overflowY,
            inputHeight: box(input).height,
            play: seen(document.querySelector("[data-play-reply]")),
            voice: seen(document.getElementById("voice-command")),
            ask: seen(document.getElementById("ask")),
            fresh: seen(document.getElementById("new-chat")),
            review: seen(document.getElementById("review")),
            field: seen(input),
            jumpAbove: box(document.querySelector("[data-jump-latest]")).bottom <= box(compose).top + 2,
            historyWidth: history && !history.hidden ? box(history).width : 0,
            otherHidden: document.getElementById("other-page").hidden,
            ribbonTools: !document.querySelector(".ua-ribbon-viewport").contains(document.querySelector(".ua-ribbon-tools")),
            minLog,
          };
        }, { minLog: size.minLog, visual: size.visual });
        if (size.label === "1366x768" || size.label === "390x700") {
          await page.screenshot({ path: `/tmp/ua-shots/${size.label}.png`, fullPage: false });
        }
        assert.equal(measured.otherHidden, true, `${size.label} still showed the other page`);
        assert.equal(measured.pageScrolls, false, `${size.label} page still scrolls`);
        assert.ok(measured.logHeight >= size.minLog, `${size.label} conversation height ${measured.logHeight}`);
        assert.equal(measured.logScrolls, true, `${size.label} history did not scroll ${measured.logHeight}/${measured.logScroll}`);
        assert.equal(measured.composeOverflow, "visible", `${size.label} composer scrolls`);
        for (const name of ["play", "voice", "ask", "fresh", "review", "field"]) {
          assert.equal(measured[name].inView, true, `${size.label} hid ${name} ${JSON.stringify(measured[name])}`);
          assert.equal(measured[name].clickable, true, `${size.label} blocked ${name}`);
        }
        assert.equal(measured.jumpAbove, true, `${size.label} latest control covered the composer`);
        assert.ok(measured.inputHeight <= 140, `${size.label} input grew to ${measured.inputHeight}`);
        assert.equal(measured.ribbonTools, true, `${size.label} pause sat inside the ribbon`);
        if (size.width >= 900 && size.zoom === 1) assert.ok(measured.historyWidth >= 200 && measured.historyWidth <= 260, `${size.label} history width ${measured.historyWidth}`);
        if (size.width < 900) assert.equal(measured.historyWidth, 0, `${size.label} history consumed the phone width`);
        await page.close();
      }
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.setContent(shell());
      await page.evaluate(() => document.getElementById("open-assistant").click());
      await page.evaluate(() => document.getElementById("voice-chooser").click());
      const voice = await page.evaluate(() => {
        const list = document.getElementById("voices");
        const last = document.querySelector("[data-voice='cedar'] [data-action='use']");
        list.scrollTop = list.scrollHeight;
        const listBox = list.getBoundingClientRect();
        const lastBox = last.getBoundingClientRect();
        const limit = window.visualViewport?.height || window.innerHeight;
        const close = document.getElementById("voice-close").getBoundingClientRect();
        return {
          scrolled: list.scrollTop > 0,
          lastInside: lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1,
          closeInView: close.top >= 0 && close.bottom <= limit,
          pageScrolls: (document.scrollingElement || document.documentElement).scrollHeight > window.innerHeight + 2,
        };
      });
      assert.equal(voice.lastInside, true);
      assert.equal(voice.closeInView, true);
      assert.equal(voice.pageScrolls, false);
      await page.evaluate(() => document.getElementById("voice-close").click());
      const afterVoice = await page.evaluate(() => ({
        closed: document.getElementById("voice-modal").hidden,
        focus: document.activeElement?.id || "",
        ask: document.getElementById("ask").getBoundingClientRect().bottom <= (window.visualViewport?.height || window.innerHeight),
      }));
      assert.equal(afterVoice.closed, true);
      assert.equal(afterVoice.focus, "voice-chooser");
      assert.equal(afterVoice.ask, true);
      await page.setViewportSize({ width: 390, height: 700 });
      await page.evaluate(() => document.getElementById("voice-chooser").click());
      const phoneVoice = await page.evaluate(() => {
        const list = document.getElementById("voices");
        const last = document.querySelector("[data-voice='cedar'] [data-action='use']");
        list.scrollTop = list.scrollHeight;
        const listBox = list.getBoundingClientRect();
        const lastBox = last.getBoundingClientRect();
        const limit = window.visualViewport?.height || window.innerHeight;
        const close = document.getElementById("voice-close").getBoundingClientRect();
        return {
          scrolled: list.scrollTop > 0,
          lastInside: lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1,
          closeInView: close.top >= 0 && close.bottom <= limit,
        };
      });
      assert.equal(phoneVoice.scrolled, true);
      assert.equal(phoneVoice.lastInside, true);
      assert.equal(phoneVoice.closeInView, true);
      await page.evaluate(() => document.getElementById("voice-close").click());
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate(() => document.getElementById("signature").click());
      const draft = await page.evaluate(() => {
        const close = document.getElementById("draft-close").getBoundingClientRect();
        const limit = window.visualViewport?.height || window.innerHeight;
        return { shown: !document.getElementById("draft-modal").hidden, close: close.top >= 0 && close.bottom <= limit };
      });
      assert.equal(draft.shown, true);
      assert.equal(draft.close, true);
      await page.evaluate(() => document.getElementById("draft-close").click());
      const restored = await page.evaluate(() => document.getElementById("ask").getBoundingClientRect().bottom <= (window.visualViewport?.height || window.innerHeight) + 1);
      assert.equal(restored, true);
    } finally {
      await browser.close();
    }
  });
});
