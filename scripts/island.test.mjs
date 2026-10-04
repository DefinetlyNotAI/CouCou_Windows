import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/island/fsm.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { IslandStateMachine } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const layout = ts.transpileModule(readFileSync(new URL("../src/core/layout.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { containsIslandPoint } = await import(`data:text/javascript;base64,${Buffer.from(layout).toString("base64")}`);
const animation = ts.transpileModule(readFileSync(new URL("../src/core/anim.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const sound = ts.transpileModule(readFileSync(new URL("../src/core/sound.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const engineSource = readFileSync(new URL("../src/mochi/engine.ts", import.meta.url), "utf8")
  .replace('from "../core/anim"', `from "data:text/javascript;base64,${Buffer.from(animation).toString("base64")}"`)
  .replace('from "../core/sound"', `from "data:text/javascript;base64,${Buffer.from(sound).toString("base64")}"`);
const engineModule = ts.transpileModule(engineSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { BotEngine } = await import(`data:text/javascript;base64,${Buffer.from(engineModule).toString("base64")}`);
test("headpat face survives emote expiry and releases when petting ends", () => {
  const bot = new BotEngine();
  bot.triggerEmote("love", 2);
  const happyEyes = bot.eyeOverride;
  bot.setPetting(true);
  bot.eyeOverrideUntil = -1;
  bot.update(1 / 60);
  assert.equal(bot.eyeOverride, happyEyes);
  assert.ok(bot.blush >= 0.7);
  bot.setPetting(false);
  bot.update(1 / 60);
  assert.equal(bot.eyeOverride, bot.permanentEye);
});
test("drops must touch the visible island, including its rounded edge", () => {
  const rect={x:100,y:0,w:200,h:80};
  assert.equal(containsIslandPoint(rect,{x:99,y:40},20),false);
  assert.equal(containsIslandPoint(rect,{x:200,y:81},20),false);
  assert.equal(containsIslandPoint(rect,{x:100,y:80},20),false);
  assert.equal(containsIslandPoint(rect,{x:120,y:75},20),true);
  assert.equal(containsIslandPoint({...rect,h:0},{x:200,y:0},20),false);
});
const timers = new Map();
let nextTimer = 0;
globalThis.window = {
  setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
};

test("minimizing and leaving the compact island never schedule disappearance", () => {
  const fsm = new IslandStateMachine();
  fsm.forceHome();
  fsm.forcePetit();
  fsm.mouseLeft();
  assert.equal(fsm.state, "petit");
  assert.equal(timers.size, 0);
  fsm.click();
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  for (const [id, callback] of timers) { timers.delete(id); callback(); }
  assert.equal(fsm.state, "petit");
  assert.equal(timers.size, 0);
});

test("only the app visibility rule hides and restores the island", () => {
  const fsm = new IslandStateMachine();
  fsm.forceHome();
  fsm.setBlocked(true);
  for (const action of ["launch", "mouseEntered", "click", "forceHome", "forcePetit", "reveal"]) fsm[action]();
  assert.equal(fsm.state, "hidden");
  assert.equal(timers.size, 0);
  fsm.setBlocked(false);
  assert.equal(fsm.state, "petit");
  fsm.click();
  assert.equal(fsm.state, "home");
});
