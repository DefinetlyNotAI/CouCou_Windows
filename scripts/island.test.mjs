import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/island/fsm.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { IslandStateMachine } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
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
