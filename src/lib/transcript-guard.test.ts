import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideTranscript,
  isDuplicateTranscript,
  micFailureMessage,
  microphoneTestReport,
  publicTranscriptionError,
  sanitizeProviderDetail,
  speechToSubmit,
  soundsLikeNoise,
  transcriptEchoesPrompt,
  transcriptionPrompt,
} from "./transcript-guard.ts";

const names = ["Casey Sample", "Riley Sample", "Quinn Sample", "Avery Sample", "Morgan Sample", "Jordan Example"];
const prompt = transcriptionPrompt(names);
const echoed = "Financial advisor. Contact names: Casey Sample, Riley Sample, Quinn Sample, Avery Sample, Morgan Sample, Jordan Example. English and Farsi are both expected.";

describe("microphone transcript is not the prompt", () => {
  it("builds an English hint and does not tell the transcriber to expect Farsi", () => {
    assert.match(prompt, /Contact names: Casey Sample/);
    assert.doesNotMatch(prompt, /Farsi/);
    assert.equal(transcriptEchoesPrompt(prompt, prompt, names), true);
    assert.equal(transcriptEchoesPrompt(echoed, prompt, names), true);
    assert.equal(transcriptEchoesPrompt("hello", prompt, names), false);
    assert.equal(transcriptEchoesPrompt("call Avery Sample", prompt, names), false);
    assert.equal(soundsLikeNoise("EHEHEHEHEHEHE"), true);
    assert.equal(soundsLikeNoise("Bzzz-bzzz-bzzz-bzzz-bzzz"), true);
    assert.equal(soundsLikeNoise("THANKS FOR WATCHING!"), true);
    assert.equal(soundsLikeNoise("Tell me three things you can help me with"), false);
  });

  it("does not post silence, an empty recording, a prompt echo, or a failed capture", () => {
    const silence = decideTranscript({ audioBytes: 80, prompt, names, browserText: "", serverText: "", serverOk: false });
    assert.equal(silence.post, false);
    if (!silence.post) assert.match(silence.message, /Nothing was heard/);
    const echo = decideTranscript({ audioBytes: 8000, prompt, names, browserText: "", serverText: echoed, serverOk: true });
    assert.equal(echo.post, false);
    if (!echo.post) assert.match(echo.message, /Nothing was heard/);
    const denied = decideTranscript({ audioBytes: 0, prompt, permissionDenied: true });
    assert.equal(denied.post, false);
    if (!denied.post) assert.match(denied.message, /permission was denied/);
    const missing = decideTranscript({ audioBytes: 0, prompt, noDevice: true });
    assert.equal(missing.post, false);
    if (!missing.post) assert.match(missing.message, /No microphone was found/);
    const failed = decideTranscript({ audioBytes: 4000, prompt, names, serverOk: false, serverText: "", browserText: "" });
    assert.equal(failed.post, false);
    if (!failed.post) assert.match(failed.message, /could not be transcribed/);
    assert.match(micFailureMessage("NotAllowedError"), /permission was denied/);
    assert.match(micFailureMessage("NotFoundError"), /No microphone was found/);
    assert.match(micFailureMessage("unsupported"), /cannot record speech/);
  });

  it("posts one genuine final, ignores interim and duplicates, and still accepts hello again later", () => {
    assert.equal(speechToSubmit([{ transcript: "hel", isFinal: false }], false), "");
    assert.equal(speechToSubmit([{ transcript: "hello", isFinal: true }, { transcript: "hello there", isFinal: false }], false), "hello");
    assert.equal(speechToSubmit([{ transcript: "hello", isFinal: false }], true), "hello");
    const hello = decideTranscript({ audioBytes: 3000, prompt, names, browserText: "hello", serverText: "hello", serverOk: true });
    assert.deepEqual(hello, { post: true, text: "hello" });
    const cancelled = decideTranscript({ audioBytes: 3000, prompt, browserText: "hello", serverOk: true, serverText: "hello", cancelled: true });
    assert.equal(cancelled.post, false);
    const stale = decideTranscript({ audioBytes: 3000, prompt, serverText: "hello", serverOk: true, stale: true });
    assert.equal(stale.post, false);
    assert.equal(isDuplicateTranscript("hello", "hello", 500), true);
    assert.equal(isDuplicateTranscript("hello", "hello", 4000), false);
    const again = decideTranscript({ audioBytes: 3000, prompt, names, browserText: "hello", serverOk: true, serverText: "hello", duplicate: false });
    assert.equal(again.post, true);
    const repeated = decideTranscript({ audioBytes: 3000, prompt, serverText: "list my contacts", serverOk: true, duplicate: true });
    assert.equal(repeated.post, false);
    const command = decideTranscript({ audioBytes: 5000, prompt, names, browserText: "", serverText: "list my contacts", serverOk: true });
    assert.deepEqual(command, { post: true, text: "list my contacts" });
  });

  it("reports microphone checks without submitting a command", () => {
    const denied = microphoneTestReport({ permission: "denied", errorName: "NotAllowedError" });
    assert.equal(denied.submit, false);
    assert.match(denied.message, /permission was denied/);
    const quiet = microphoneTestReport({ trackState: "live", deviceLabel: "Microphone", bytes: 900, mime: "audio/webm", level: 0, recognition: true });
    assert.equal(quiet.submit, false);
    assert.match(quiet.message, /no speech was detected/);
    assert.match(quiet.message, /did not send a command|try again/);
    const heard = microphoneTestReport({ trackState: "live", deviceLabel: "MacBook Microphone", bytes: 4200, mime: "audio/webm", level: 0.2, recognition: false });
    assert.equal(heard.submit, false);
    assert.match(heard.message, /Sound was detected/);
    assert.match(heard.message, /did not send a command/);
    assert.match(heard.message, /transcribes it when you tap Stop/);
  });

  it("shows the transcription failure instead of a generic sentence, and still accepts browser speech", () => {
    const closed = decideTranscript({
      audioBytes: 8024,
      prompt,
      names,
      browserText: "",
      serverOk: false,
      serverError: "The language model is off in this environment. No model request was made.",
    });
    assert.equal(closed.post, false);
    if (!closed.post) assert.match(closed.message, /language model is off/);
    assert.doesNotMatch(closed.post ? "" : closed.message, /could not be transcribed/);
    const refused = publicTranscriptionError({
      stage: "provider",
      status: 401,
      model: "whisper-1",
      mime: "audio/webm;codecs=opus",
      bytes: 8024,
      detail: "Incorrect API key sk-secretvalue provided",
    });
    assert.match(refused, /whisper-1 \(401\)/);
    assert.match(refused, /8024 bytes, audio\/webm/);
    assert.doesNotMatch(refused, /sk-secret/);
    assert.match(sanitizeProviderDetail("Bearer abcdefghijklmnop"), /Bearer \[key\]/);
    const heard = decideTranscript({
      audioBytes: 8024,
      prompt,
      names,
      browserText: "hello",
      serverOk: false,
      serverError: refused,
    });
    assert.deepEqual(heard, { post: true, text: "hello" });
    const timedOut = publicTranscriptionError({ stage: "timeout", mime: "audio/webm;codecs=opus", bytes: 8024 });
    assert.match(timedOut, /did not answer in time/);
    assert.match(timedOut, /Nothing was added to the chat/);
  });
});
