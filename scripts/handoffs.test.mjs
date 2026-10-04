import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";

const bridgeSource = readFileSync(new URL("../src/core/bridge.ts", import.meta.url), "utf8");
const bridge = ts.transpileModule(bridgeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from "(@tauri-apps\/api\/[^\"]+)"/g, (_, specifier) => `from "${import.meta.resolve(specifier)}"`);
const bridgeUrl = `data:text/javascript;base64,${Buffer.from(bridge).toString("base64")}`;
const chatData = ts.transpileModule(readFileSync(new URL("../src/core/chat-data.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const chatDataUrl = `data:text/javascript;base64,${Buffer.from(chatData).toString("base64")}`;
const source = readFileSync(new URL("../src/core/state.ts", import.meta.url), "utf8").replace('from "./bridge"', `from "${bridgeUrl}"`).replace('from "./chat-data"', `from "${chatDataUrl}"`);
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { State } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const timers = new Map();
let nextTimer = 0;
globalThis.window = {
  setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
};

test("saved chat loading skips malformed metadata and retains valid chats", async () => {
  const valid={id:"valid",title:"Saved",updatedAt:1,messages:[]};
  globalThis.localStorage={getItem:()=>JSON.stringify([{...valid,id:"invalid",tags:{}},valid])};
  await State.loadChats();
  assert.deepEqual(State.savedChats,[valid]);
  assert.equal(State.chatStatus,"");
});

test("concurrent helpers return independently and leave no stale actors", () => {
  State.startHandoff({ id: "turn:github", name: "GitHub", color: "#F4505E", kind: "service" });
  State.startHandoff({ id: "turn:agent", name: "Researcher", color: "#2EC4A0", kind: "agent" });
  State.finishHandoff("turn:github");
  assert.equal(State.handoffs.find(item => item.id === "turn:github").status, "returning");
  assert.equal(State.handoffs.find(item => item.id === "turn:agent").status, "working");
  const deliveryTimer = [...timers.values()][0];
  State.startHandoff({ id: "turn:github", name: "GitHub", color: "#F4505E", kind: "service" });
  deliveryTimer();
  assert.equal(State.handoffs.find(item => item.id === "turn:github").status, "working");
  State.startHandoff({ id: "other:mcp", name: "Files MCP", color: "#38BDF8", kind: "mcp" });
  State.endHandoffs("turn", true);
  assert.equal(State.handoffs.find(item => item.id === "other:mcp").status, "working");
  assert.equal(State.handoffs.find(item => item.id === "turn:agent").status, "cancelled");
  for (const callback of [...timers.values()]) callback();
  assert.deepEqual(State.handoffs.map(item => item.id), ["other:mcp"]);
  State.endHandoffs("other", false);
  assert.equal(State.handoffs[0].status, "error");
  for (const callback of [...timers.values()]) callback();
  assert.equal(State.handoffs.length, 0);
});
