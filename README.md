# CouCou Shahm Edition

Preferences, chats, indexes, schedules and imported attachments are encrypted with Windows DPAPI for the current Windows account. Browser-only development previews use browser storage. Use **Chats and backups → Encrypted backup** for password-protected exports that can be restored on another PC; service credentials stay in Windows Credential Manager.

Portable mode: put `portable.flag` beside `coucou.exe`, or launch with `COUCOU_PORTABLE=1`. App data is written to its adjacent `data` folder. DPAPI data remains tied to the Windows account; use an encrypted backup to transfer it between PCs.

Browser-backed search: choose the Browser provider and set its URL to a local Chromium debugging endpoint such as `http://127.0.0.1:9222`. Your installed Chromium browser must already have remote debugging enabled. Coucou opens a new tab, extracts visible text and links, and closes that tab. DuckDuckGo and SearXNG providers do not require browser setup.

Shortcuts: `Ctrl+K` commands, `Ctrl+Shift+N` new chat, `Ctrl+.` stop. Slash commands: `/new`, `/stop`, `/continue`, `/fullscreen`, `/settings`, `/temp`, `/search query`, `/screenshot`, `/clipboard`, `/upload`.

Windows desktop companion, version **v0.1.1-ollama**. Maintained at [DefinetlyNotAI/CouCou_Windows](https://github.com/DefinetlyNotAI/CouCou_Windows).

Chat with local Ollama models, handle model tool calls, search the web, and attach files. GitHub, Vercel, Resend, n8n, Stripe, Notion and Cal.com integrations are available in Settings. Minimising keeps Mochi compact at the top of the screen. Fullscreen applications and configured programs temporarily hide it; it returns automatically when they stop covering the screen.

## Install

Run `release/CouCou-Shahm-Edition-v0.1.1-ollama-setup.exe` after building. Windows 10/11 and Microsoft Edge WebView2 Runtime are required.

For local chat, install Ollama, download a model, and select it in Settings. Tool calls require a model with tool support. Basic web search supports DuckDuckGo, SearXNG and browser retrieval without an API key.

The optional browser model backend runs a separate WebGPU model inside the application's WebView2 environment. It downloads compatible MLC weights and requires a supported GPU; it cannot reuse Ollama model files. Select a tool-capable browser model to use tools.

## Build on Windows

Install Node.js 22+, Rust's stable MSVC toolchain, Visual Studio Build Tools with **Desktop development with C++**, and WebView2 Runtime. From the repository root:

```powershell
npm ci
npm run pack
```

The installer is written to `release/`. For development, run `npm run tauri dev`.

## Verify

```powershell
npm run build
cargo test
node --test scripts/island.test.mjs
```

Preferences and logs remain in `%APPDATA%\Coucou` and `%LOCALAPPDATA%\Coucou`. API credentials use Windows Credential Manager. Build output and local secrets are ignored by Git.

Source code is MIT licensed; the original character, brand and sound assets have separate terms in [LICENSE-ASSETS.md](LICENSE-ASSETS.md).
