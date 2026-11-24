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
    assert.match(assistant, /speakInBrowser\(line/);
    assert.match(desk, /ua-practice-shell/);
    assert.match(desk, /ua-assistant-lock/);
    assert.match(read("src/lib/voice-desk.ts"), /export function preferredBrowserVoice/);
    assert.match(read("src/lib/voice-desk.ts"), /BROWSER_VOICE_FALLBACK/);
    assert.match(assistant, /playStoredReply/);
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
    assert.match(read("src/lib/form-lookup.ts"), /I could not find this form in Useful Links\. Would you like me to search online\?/);
    const replay = assistant.slice(assistant.indexOf("async function replaySpoken"), assistant.indexOf("async function askByVoice"));
    assert.match(replay, /playStoredReply/);
    assert.match(replay, /speakInBrowser\(/);
    assert.match(replay, /Preparing the reply/);
    assert.doesNotMatch(replay, /setPlaybackNote\("Playing the reply/);
    assert.doesNotMatch(replay, /await speak\(line\)/);
    assert.doesNotMatch(replay, /ask\(/);
    assert.match(assistant, /data-mic-test/);
    assert.match(assistant, /microphoneTestReport/);
    assert.match(assistant, /decideTranscript/);
    assert.doesNotMatch(read("src/routes/api/assistant/voice.ts"), /12000|Promise\.race/);
    assert.match(read("src/routes/api/assistant/voice.ts"), /await speakVisible/);
    assert.match(desk, /ua-assistant-main/);
    assert.match(desk, /Signature preview/);
    assert.match(desk, /Document email/);
    assert.match(assistant, /data-new-chat/);
    assert.match(assistant, /data-voice-command/);
    assert.match(read("src/components/advisor-voice.tsx"), /ua-voice-dialog/);
    assert.doesNotMatch(assistant, /className="ua-assist-tools[\s\S]{0,240}>AI assistant</);
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

