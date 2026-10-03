# CouCou Shahm Edition v0.1.1-ollama

Mochi lives at the top of your screen. Chat with downloaded Ollama models,
ask about dropped files, and follow the model's tool activity in the island.

## Set up Ollama

1. Install [Ollama](https://ollama.com/download/windows) and start it.
2. Download a local model with `ollama pull <model>`.
3. Open **Settings → Ollama**, connect to `http://127.0.0.1:11434` (or your
   Ollama server), and select an installed model.

Model capabilities are checked automatically. Local inference needs no API key.
Only downloaded local models are accepted. Existing sound, screen, startup and
Ollama preferences and service integrations survive upgrades.

Alternatively select **Browser (WebGPU)** in Settings. It runs a supported MLC
model inside CouCou's WebView2 environment, with a separate first-use download
and a compatible GPU. It cannot reuse Ollama's model files. Llama 1B supports
chat; Hermes 8B also supports tools. Initialization is limited to ten minutes.
GitHub, Vercel, Resend, n8n, Stripe, Notion and Cal.com are available in Settings.

## Chat and tool hooks

Replies stream as they are generated. Loading, thinking and tool activity have
visible status. **Stop reply** cancels the request, and the **+** button clears its
conversation and attachment. Failed or cancelled turns are not retained by the
model. A configurable deadline (120 seconds by default) and a 60-second stream
inactivity limit prevent an endless wait.

Enable **Tool hooks** for models with tool calling. Coucou handles their tool
calls, shows tool starts/results in the overview, and feeds results back into
the conversation. The built-in tools are:

- **get_current_time**: reads the computer's local date and time.
- **web_search**: returns current search results and source links.
- **web_fetch**: reads a public web page for a follow-up answer.

Web tools use [Ollama's official web APIs](https://docs.ollama.com/capabilities/web-search).
Enable **Web search** and save an Ollama API key in Settings. The key stays in
Windows Credential Manager. Search queries and requested URLs go to ollama.com;
model inference remains on the configured local server. Without a key, web
tools are not advertised. Models without tool support can still chat normally.
Tool calls are limited to eight per question. No arbitrary commands run.

Dropped UTF-8 text/code files up to 200 KB are supported. Images need a vision
model. PDFs need text extraction first. Unsupported files show a clear error.

## Controls

- Mochi stays in a compact bar at the top of the screen; click to open.
- **Mute** toggles sound. **Minimize**, beside it, makes the island compact.
- Fullscreen foreground applications temporarily hide it. In General settings,
  list executable names such as `opera.exe` to also hide it when those foreground
  windows touch the monitor's top edge. It returns automatically when they leave.
- The counter below Mochi shows the last reported generation speed in TPS.
- **Esc** collapses the island. Drag a file onto it to ask about the file.
- Tray menu: Open, Settings, Pause, Quit.

No telemetry. Request and tool lifecycle logs stay in
`%LOCALAPPDATA%\Coucou\coucou.log`; keys and chat text are not logged.

## Build

Requirements: [Rust](https://rustup.rs), [Node 20+](https://nodejs.org), and MSVC
build tools with Desktop development with C++. WebView2 ships with Windows.

```powershell
cd windows
npm install
npm run tauri dev
npm run pack
```

The installers land in `windows/release/CouCou-Shahm-Edition-v0.1.1-ollama-setup.exe` and
`windows/release/CouCou-Shahm-Edition-setup.exe`. The standalone executable is
`windows/target/release/coucou.exe`. Installers are unsigned.

Verification: `cargo test -p coucou`, `node --test scripts/island.test.mjs`, and `npm run build`. The ignored live
Ollama test can be run with
`cargo test -p coucou live_ollama_greeting_and_tool_call -- --ignored --nocapture`.
It uses the installed gemma3:4b model by default; set COUCOU_TEST_MODEL to a
model with tools to verify a live get_current_time call.

## Linux

The shared Tauri app also builds on Linux. Its platform layer uses XDG
locations, Secret Service for the optional web key, and gtk-layer-shell on
supported compositors. The updated Ollama flow is shared; this change was
verified on Windows.
