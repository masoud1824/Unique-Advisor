import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

describe("english desk and news ribbon source", () => {
  it("hides Farsi choices, keeps sign-out off the assistant, and scrolls the full ribbon", () => {
    const ribbon = read("src/components/news-ribbon.tsx");
    const css = read("src/styles.css");
    const assistant = read("src/components/assistant-desk.tsx");
    const desk = read("src/routes/a/$slug/desk.tsx");
    const newsAdmin = read("src/routes/news-admin.tsx");
    assert.doesNotMatch(ribbon, /فارسی|setDeskLanguage|choose\("fa"\)/);
    assert.match(ribbon, /ua-ribbon-viewport[\s\S]*ua-ribbon-tools/);
    assert.match(ribbon, /newsHeadlineLink/);
    assert.match(css, /@keyframes ua-ribbon-travel[\s\S]*translate3d\(var\(--ua-ribbon-start, 100cqi\)[\s\S]*translate3d\(-100%/);
    assert.match(css, /\.ua-ribbon-track\.is-paused \{ animation-play-state: paused; \}/);
    assert.doesNotMatch(assistant, /voiceLang === "fa-IR"|فارسی/);
    assert.match(desk, /tab !== "assistant" &&[\s\S]{0,180}Sign out/);
    assert.match(read("src/routes/admin.tsx"), /Sign out/);
    assert.doesNotMatch(newsAdmin, /en or fa|فارسی/);
    assert.match(read("src/lib/news-ribbon.ts"), /export function advisorRibbonLanguage/);
    assert.match(css, /\.ua-assist-compose \{[^}]*overflow:\s*visible/);
    assert.doesNotMatch(css, /\.ua-assist-compose \{[^}]*max-height:\s*62%/);
    assert.match(assistant, /data-command-bar/);
    assert.match(assistant, /data-play-reply/);
    assert.match(assistant, /ua-assist-stage/);
    assert.match(assistant, /speakInBrowser\(line\)/);
    assert.match(desk, /ua-practice-shell/);
    assert.match(desk, /ua-assistant-lock/);
    assert.match(read("src/lib/voice-desk.ts"), /export function preferredBrowserVoice/);
    assert.match(read("src/lib/voice-desk.ts"), /BROWSER_VOICE_FALLBACK/);
    assert.match(assistant, /BROWSER_VOICE_FALLBACK/);
    assert.doesNotMatch(ribbon, /List/);
    const nav = desk.slice(desk.indexOf("const nav = ["), desk.indexOf("];", desk.indexOf("const nav = [")));
    assert.doesNotMatch(nav, /Birthdays|Article library/);
    const toolbar = desk.slice(desk.indexOf("ua-desk-toolbar"), desk.indexOf("jsx(InstallPhone"));
    assert.match(toolbar, /AI assistant/);
    assert.doesNotMatch(toolbar, /Voice command|New chat/);
    assert.match(desk, /TodayBirthdays/);
    assert.match(desk, /Birthday settings|onSettings/);
    assert.match(read("src/components/install-phone.tsx"), /Install the desk/);
    assert.match(read("src/components/install-phone.tsx"), /does not sign out other devices/);
    assert.doesNotMatch(read("src/components/install-phone.tsx"), /Install the desk on your phone/);
    assert.match(read("src/components/newsletter-desk.tsx"), /Create newsletter/);
    assert.match(read("src/components/newsletter-desk.tsx"), /Article library/);
    assert.doesNotMatch(read("src/components/newsletter-desk.tsx"), /Market Update|Financial Tips|Seasonal Greeting/);
    assert.match(read("src/lib/newsletter.ts"), /export function blankIssue/);
    assert.match(read("src/styles.css"), /\.ua-design-grid \{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(read("src/lib/form-lookup.ts"), /It was not found in Useful Links\. Do you want me to search the web\?/);
    const replay = assistant.slice(assistant.indexOf("async function replaySpoken"), assistant.indexOf("async function askByVoice"));
    assert.match(replay, /speakInBrowser\(line\)/);
    assert.doesNotMatch(replay, /await speak\(line\)/);
    assert.doesNotMatch(read("src/routes/api/assistant/voice.ts"), /12000|Promise\.race/);
    assert.match(read("src/routes/api/assistant/voice.ts"), /await speakVisible/);
  });
});

const chrome = ["/opt/pw-browsers/chromium-1248/chrome-linux64/chrome"].find((path) => existsSync(path));
const playwright = [
  resolve(root, "node_modules/playwright-core/index.js"),
  "/opt/ua-release/repos/staging/node_modules/playwright-core/index.js",
].find((path) => existsSync(path));

describe("news ribbon motion", { skip: !chrome || !playwright }, () => {
  it("crosses the full width for short and long headlines and keeps Pause still", async () => {
    const require = createRequire(import.meta.url);
    const { chromium } = require(playwright);
    const css = read("src/styles.css").replace(/^@import[^\n]*\n/, "");
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage();
      const samples = [
        { width: 1280, height: 800, headline: "Rates" },
        { width: 1280, height: 800, headline: "A long staging headline that has to travel the entire ribbon before it leaves the left edge ".repeat(4).trim() },
        { width: 390, height: 700, headline: "Rates" },
        { width: 390, height: 700, headline: "Mobile headline with enough words to be wider than the phone ribbon itself and still exit left" },
      ];
      for (const sample of samples) {
        await page.setViewportSize({ width: sample.width, height: sample.height });
        await page.setContent(`<!doctype html><style>${css}</style>
          <div class="ua-ribbon-bar" id="bar">
            <div class="ua-ribbon-viewport" data-ticker-viewport>
              <div class="ua-ribbon-track" data-ticker-track>
                <a class="ua-ribbon-item" href="https://example.invalid/rates" target="_blank" rel="noopener noreferrer">${sample.headline}</a>
              </div>
            </div>
            <div class="ua-ribbon-tools" role="toolbar">
              <button type="button" id="pause" style="min-width:48px">Pause</button>
            </div>
          </div>
          <script>
            const view = document.querySelector("[data-ticker-viewport]");
            const track = document.querySelector("[data-ticker-track]");
            const start = view.clientWidth;
            track.style.setProperty("--ua-ribbon-start", start + "px");
            track.style.animationDuration = "8000ms";
            document.getElementById("pause").addEventListener("click", () => {
              const paused = track.classList.toggle("is-paused");
              document.getElementById("pause").textContent = paused ? "Run" : "Pause";
            });
          </script>`);
        const measured = await page.evaluate(async () => {
          const view = document.querySelector("[data-ticker-viewport]");
          const track = document.querySelector("[data-ticker-track]");
          const tools = document.querySelector(".ua-ribbon-tools");
          const bar = document.getElementById("bar");
          const link = document.querySelector(".ua-ribbon-item");
          const animation = track.getAnimations()[0];
          animation.pause();
          animation.currentTime = 0;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const atStart = track.getBoundingClientRect();
          const viewport = view.getBoundingClientRect();
          const halfway = animation.effect.getComputedTiming().duration / 2;
          animation.currentTime = halfway;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const atMiddle = track.getBoundingClientRect();
          const duration = animation.effect.getComputedTiming().duration;
          animation.currentTime = Math.max(0, duration - 32);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const atEnd = track.getBoundingClientRect();
          const held = animation.currentTime;
          document.getElementById("pause").click();
          await new Promise((resolve) => setTimeout(resolve, 80));
          const whilePaused = animation.playState === "paused" && Math.abs(animation.currentTime - held) < 50;
          document.getElementById("pause").click();
          const resumed = !track.classList.contains("is-paused");
          const toolBox = tools.getBoundingClientRect();
          const barBox = bar.getBoundingClientRect();
          return {
            startGap: Math.abs(atStart.left - viewport.right),
            endGap: Math.abs(atEnd.right - viewport.left),
            travel: Math.abs(atStart.left - atMiddle.left),
            viewport: viewport.width,
            toolsInside: view.contains(tools),
            toolsVisible: toolBox.width > 40 && toolBox.right <= barBox.right + 1 && toolBox.left >= barBox.left,
            toolsClear: toolBox.left >= viewport.right - 2,
            whilePaused,
            resumed,
            external: link.target === "_blank" && link.rel.includes("noopener"),
          };
        });
        assert.ok(measured.startGap < 3, `${sample.width} ${sample.headline.slice(0, 24)} start ${measured.startGap}`);
        assert.ok(measured.endGap < 8, `${sample.width} end ${measured.endGap}`);
        assert.ok(measured.travel > measured.viewport * 0.35, `${sample.width} travel ${measured.travel} of ${measured.viewport}`);
        assert.equal(measured.toolsInside, false);
        assert.equal(measured.toolsVisible, true);
        assert.equal(measured.toolsClear, true);
        assert.equal(measured.whilePaused, true);
        assert.equal(measured.resumed, true);
        assert.equal(measured.external, true);
      }
    } finally {
      await browser.close();
    }
  });

  it("keeps every voice Use control reachable at laptop and phone widths", async () => {
    const require = createRequire(import.meta.url);
    const { chromium } = require(playwright);
    const css = read("src/styles.css").replace(/^@import[^\n]*\n/, "");
    const voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 700 });
        await page.setContent(`<!doctype html><style>${css}</style>
          <div class="ua-assist-compose" style="width:${width === 1280 ? 720 : 350}px">
            <div class="ua-voice-panel">
              <div class="ua-voice-list">
                ${voices.map((voice, index) => `<div class="ua-voice-row" data-voice="${voice}" ${index === 1 ? "data-in-use=\"true\"" : ""}>
                  <span class="ua-voice-name"><strong>${voice}</strong>${index === 1 ? "<span class=\"ua-voice-used\">In use</span>" : ""}</span>
                  <audio controls></audio>
                  <button type="button" class="ua-voice-preview">Preview</button>
                  <button type="button" class="ua-voice-use" data-action="use">Use</button>
                </div>`).join("")}
              </div>
            </div>
          </div>`);
        const measured = await page.evaluate(() => {
          const list = document.querySelector(".ua-voice-list");
          const last = document.querySelector("[data-voice='cedar'] [data-action='use']");
          last.scrollIntoView({ block: "nearest" });
          const listBox = list.getBoundingClientRect();
          const lastBox = last.getBoundingClientRect();
          const ash = document.querySelector("[data-voice='ash']");
          const ashUse = ash.querySelector("[data-action='use']");
          const ashBox = ash.getBoundingClientRect();
          const ashUseBox = ashUse.getBoundingClientRect();
          return {
            scrolled: list.scrollTop > 0,
            lastVisible: lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1 && lastBox.right <= listBox.right + 1,
            ashUseInside: ashUseBox.left >= ashBox.left - 1 && ashUseBox.right <= ashBox.right + 1 && ashUseBox.top >= ashBox.top - 1 && ashUseBox.bottom <= ashBox.bottom + 1,
          };
        });
        assert.equal(measured.scrolled, true, `${width} did not scroll to the last voice`);
        assert.equal(measured.lastVisible, true, `${width} hid the last Use button`);
        assert.equal(measured.ashUseInside, true, `${width} wrapped the selected voice controls`);
      }
    } finally {
      await browser.close();
    }
  });
});

describe("assistant command bar", { skip: !chrome || !playwright }, () => {
  it("scrolls only the chat log and keeps Play reply with the command buttons", async () => {
    const require = createRequire(import.meta.url);
    const { chromium } = require(playwright);
    const css = read("src/styles.css").replace(/^@import[^\n]*\n/, "");
    const voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage();
      const sizes = [
        { width: 1280, height: 800, visual: 0 },
        { width: 1280, height: 640, visual: 0 },
        { width: 390, height: 700, visual: 0 },
        { width: 390, height: 700, visual: 430 },
      ];
      for (const size of sizes) {
        await page.setViewportSize({ width: size.width, height: size.height });
        const shellStyle = size.visual ? ` style="--ua-vvh: ${size.visual}px"` : "";
        await page.setContent(`<!doctype html><style>${css}</style>
          <div class="ua-practice-shell"${shellStyle}>
            <div data-practice-banner style="padding:10px 16px;text-align:center;background:#8a3a12;color:#fff">Staging practice. Outbound mail is blocked.</div>
            <div class="ua-desk ua-assistant-lock">
              <aside class="ua-side">
                <div class="ua-logo" style="padding:12px">Unique Advisor</div>
                <nav>
                  <button type="button" class="ua-navbtn">AI assistant</button>
                  <button type="button" class="ua-navbtn">Contacts</button>
                </nav>
              </aside>
              <main>
                <div class="ua-desk-toolbar">AI assistant Voice command New chat</div>
                <section class="ua-panel">Install the desk on your phone. ${"Add it to the home screen. ".repeat(12)}</section>
                <section class="ua-panel">Signature workflow preview. ${"Nothing is sent. ".repeat(20)}</section>
                <div class="ua-desk-heading"><h1>AI assistant</h1><span>Practice</span></div>
                <div class="ua-ribbon-bar"><div class="ua-ribbon-viewport"><div class="ua-ribbon-track"><a class="ua-ribbon-item" href="https://example.invalid/rates">Rates</a></div></div><div class="ua-ribbon-tools"><button type="button">Pause</button></div></div>
                <div class="ua-assist-stage">
                  <section class="ua-assist-panel">
                    <div class="ua-assist-tools"><h2>AI assistant</h2></div>
                    <div class="ua-assist">
                      <aside class="ua-assist-list"><p class="ua-assist-head">Previous chats</p><div class="ua-assist-chats">${Array.from({ length: 8 }, (_, index) => `<p>Chat ${index}</p>`).join("")}</div></aside>
                      <div class="ua-assist-talk" id="talk">
                        <p class="ua-assist-head">This chat</p>
                        <div class="ua-assist-log" id="log">
                          ${Array.from({ length: 24 }, (_, index) => `<p>Message ${index} stays in the history and must not push the command bar off the page.</p>`).join("")}
                        </div>
                        <form class="ua-assist-compose" data-command-bar>
                          <p class="ua-playback-note" role="status">The browser blocked playback. Press Play reply.</p>
                          <div class="ua-voice-list" id="voices">
                            ${voices.map((voice) => `<div class="ua-voice-row" data-voice="${voice}"><span class="ua-voice-name">${voice}</span><button type="button" class="ua-voice-preview">Preview</button><button type="button" class="ua-voice-use" data-action="use">Use</button></div>`).join("")}
                          </div>
                          <textarea class="ua-field" id="ai-assistant-input" rows="3">Ask the AI assistant</textarea>
                          <div class="ua-command-row">
                            <button type="button" data-play-reply>Play reply</button>
                            <button type="button" id="voice-command">Voice command</button>
                            <button type="button" id="review">Review clients</button>
                            <button type="submit" id="ask">Ask</button>
                            <button type="button" id="new-chat">New chat</button>
                          </div>
                        </form>
                      </div>
                    </div>
                  </section>
                </div>
              </main>
            </div>
          </div>`);
        const measured = await page.evaluate((visual) => {
          const log = document.getElementById("log");
          const compose = document.querySelector(".ua-assist-compose");
          const voices = document.getElementById("voices");
          const last = document.querySelector("[data-voice='cedar']");
          const lastUse = last.querySelector("[data-action='use']");
          voices.scrollTop = voices.scrollHeight;
          const limit = visual || window.innerHeight;
          const play = document.querySelector("[data-play-reply]");
          const box = (node) => node.getBoundingClientRect();
          const playBox = box(play);
          const askBox = box(document.getElementById("ask"));
          const voiceBox = box(document.getElementById("voice-command"));
          const newBox = box(document.getElementById("new-chat"));
          const logBox = box(log);
          const listBox = box(voices);
          const lastBox = box(lastUse);
          const root = document.scrollingElement || document.documentElement;
          const composeStyle = getComputedStyle(compose);
          return {
            logScrolls: log.scrollHeight > log.clientHeight + 4,
            composeDoesNotScroll: composeStyle.overflowY === "visible" && compose.scrollHeight <= compose.clientHeight + 2,
            pageDoesNotScroll: root.scrollHeight <= window.innerHeight + 2 && root.scrollTop === 0,
            commandBelowHistory: playBox.top >= logBox.bottom - 1,
            playInView: playBox.top >= 0 && playBox.bottom <= limit && playBox.height > 0,
            askInView: askBox.top >= 0 && askBox.bottom <= limit,
            voiceInView: voiceBox.top >= 0 && voiceBox.bottom <= limit,
            newInView: newBox.top >= 0 && newBox.bottom <= limit,
            lastVoiceReachable: lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1 && lastBox.right <= listBox.right + 1,
            voiceListScrolls: voices.scrollHeight > voices.clientHeight + 4,
          };
        }, size.visual);
        const label = `${size.width}x${size.height}${size.visual ? ` keyboard ${size.visual}` : ""}`;
        assert.equal(measured.logScrolls, true, `${label} history did not scroll`);
        assert.equal(measured.composeDoesNotScroll, true, `${label} composer still scrolls`);
        assert.equal(measured.pageDoesNotScroll, true, `${label} page still scrolls`);
        assert.equal(measured.commandBelowHistory, true, `${label} command overlapped the history`);
        assert.equal(measured.playInView, true, `${label} hid Play reply`);
        assert.equal(measured.askInView, true, `${label} hid Ask`);
        assert.equal(measured.voiceInView, true, `${label} hid Voice command`);
        assert.equal(measured.newInView, true, `${label} hid New chat`);
        assert.equal(measured.voiceListScrolls, true, `${label} voice list did not scroll`);
        assert.equal(measured.lastVoiceReachable, true, `${label} hid the last voice`);
      }
    } finally {
      await browser.close();
    }
  });
});
