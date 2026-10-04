import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/core/voice.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Voice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("ending speech cancels its listening monitor without waiting for silence", async t => {
  let stopRecording;
  t.mock.method(Voice, "listen", () => new Promise((_resolve, reject) => { stopRecording = () => reject(new Error("Stopped")); }));
  t.mock.method(Voice, "speak", async () => "");
  const stop = t.mock.method(Voice, "stopListening", () => stopRecording());
  assert.equal(await Voice.speakAndListen("Hello", () => {}, () => {}), "");
  assert.equal(stop.mock.callCount(), 1);
});

test("speech interruption retains the next utterance for the call", async t => {
  let detectSpeech, deliverTranscript, stopPlayback;
  t.mock.method(Voice, "listen", (_progress, _level, onSpeech) => {
    detectSpeech = onSpeech;
    return new Promise(resolve => { deliverTranscript = resolve; });
  });
  t.mock.method(Voice, "speak", () => new Promise((_resolve, reject) => { stopPlayback = () => reject(new Error("Interrupted")); }));
  t.mock.method(Voice, "stopSpeaking", () => stopPlayback());
  let interrupted = false;
  const result = Voice.speakAndListen("Long response", () => {}, () => { interrupted = true; });
  detectSpeech();
  deliverTranscript("Please stop and explain that again");
  assert.equal(await result, "Please stop and explain that again");
  assert.equal(interrupted, true);
});

test("cancelled microphone requests stop tracks granted after cancellation", async t => {
  let grantMicrophone;
  let stopped = false;
  t.mock.method(Voice, "audioContext", async () => ({}));
  const navigator = { mediaDevices: { getUserMedia: () => new Promise(resolve => { grantMicrophone = resolve; }) } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator; });
  const recording = Voice.listen(() => {});
  await Promise.resolve();
  Voice.cancel();
  grantMicrophone({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await assert.rejects(recording, /Voice stopped/);
  assert.equal(stopped, true);
});
