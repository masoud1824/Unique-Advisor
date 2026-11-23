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
  it("crosses the full width for short and long headlines and keeps Pause and List still", async () => {
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
              <button type="button" id="pause">Pause</button>
              <button type="button" id="list">List</button>
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
      for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 700 }]) {
        await page.setViewportSize(size);
        await page.setContent(`<!doctype html><style>${css}</style>
          <section class="ua-assist-talk" id="talk">
            <p class="ua-assist-head">This chat</p>
            <div class="ua-assist-log" id="log">
              ${Array.from({ length: 12 }, (_, index) => `<p>Message ${index} stays in the history.</p>`).join("")}
            </div>
            <form class="ua-assist-compose" data-command-bar>
              <p class="ua-playback-note" role="status">The browser blocked playback. Press Play reply.</p>
              <div class="ua-voice-list" id="voices">
                ${voices.map((voice) => `<div class="ua-voice-row" data-voice="${voice}"><span class="ua-voice-name">${voice}</span><button type="button">Use</button></div>`).join("")}
              </div>
              <textarea class="ua-field" id="ai-assistant-input" rows="3">Ask the AI assistant</textarea>
              <div class="ua-command-row">
                <button type="button" data-play-reply>Play reply</button>
                <button type="button" id="voice-command">Voice command</button>
                <button type="submit" id="ask">Ask</button>
              </div>
            </form>
          </section>`);
        const measured = await page.evaluate(() => {
          const log = document.getElementById("log");
          const compose = document.querySelector(".ua-assist-compose");
          const voices = document.getElementById("voices");
          const last = document.querySelector("[data-voice='cedar']");
          last.scrollIntoView({ block: "nearest" });
          const play = document.querySelector("[data-play-reply]");
          const ask = document.getElementById("ask");
          play.scrollIntoView({ block: "nearest" });
          const playBox = play.getBoundingClientRect();
          const askBox = ask.getBoundingClientRect();
          const voiceBox = document.getElementById("voice-command").getBoundingClientRect();
          const logBox = log.getBoundingClientRect();
          const listBox = voices.getBoundingClientRect();
          const lastBox = last.getBoundingClientRect();
          const composeStyle = getComputedStyle(compose);
          return {
            logScrolls: log.scrollHeight > log.clientHeight + 4,
            composeDoesNotScroll: composeStyle.overflowY === "visible" && compose.scrollHeight <= compose.clientHeight + 2,
            commandBelowHistory: playBox.top >= logBox.bottom - 1,
            playInView: playBox.top >= 0 && playBox.bottom <= window.innerHeight && playBox.height > 0,
            askInView: askBox.top >= 0 && askBox.bottom <= window.innerHeight,
            voiceInView: voiceBox.top >= 0 && voiceBox.bottom <= window.innerHeight,
            lastVoiceReachable: lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1,
            voiceListScrolls: voices.scrollHeight > voices.clientHeight + 4,
          };
        });
        assert.equal(measured.logScrolls, true, `${size.width} history did not scroll`);
        assert.equal(measured.composeDoesNotScroll, true, `${size.width} composer still scrolls`);
        assert.equal(measured.commandBelowHistory, true, `${size.width} command overlapped the history`);
        assert.equal(measured.playInView, true, `${size.width} hid Play reply`);
        assert.equal(measured.askInView, true, `${size.width} hid Ask`);
        assert.equal(measured.voiceInView, true, `${size.width} hid Voice command`);
        assert.equal(measured.voiceListScrolls, true, `${size.width} voice list did not scroll`);
        assert.equal(measured.lastVoiceReachable, true, `${size.width} hid the last voice`);
      }
    } finally {
      await browser.close();
    }
  });
});
