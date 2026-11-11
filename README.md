# DualTran Translate for Logseq

**Read foreign notes without losing the source.** Put the cursor in a block, run *Translate block (below)*,
and the translation is inserted as the next block — the original stays exactly where it was.

Two engines:

- **Google Translate** — no key, no configuration, works out of the box
- **AI** — any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Moonshot, local Ollama,
  …) or one of the 20+ built-in providers, with your own key; the key is stored in this graph's
  plugin settings only

## Install

**Marketplace (recommended):** in Logseq open **Plugins → Marketplace**, search
“DualTran Translate”, then click **Install**.

**From source (development):**

```bash
git clone https://github.com/seigwen/dualtran-logseq
cd dualtran-logseq
npm install && npm run build
```

Then in Logseq: **Settings → Advanced → Developer mode** on → **Plugins → Load unpacked plugin**
→ pick this folder.

## Commands

| Where | Command | Effect |
|---|---|---|
| Slash menu / command palette | `Translate block (below)` | Translates the current block, inserts the result as a sibling |
| Slash menu / command palette | `Translate page to a new page` | Translates every block into a new page named `<page> · <lang>` |
| Command palette | `DualTran: settings` | Opens the settings panel |
| Command palette | `DualTran: refresh provider and model list` | Re-fetches the models.dev catalogue |

## Settings

Settings live in a dedicated panel (command palette → **DualTran: settings**; on Logseq 2.x the
plugin card's **Open settings** also has a button for it). It follows the same design as the
DualTran Obsidian plugin:

| Control | Behaviour |
|---|---|
| Engine | Google Translate or AI (BYOK) |
| Interface language | Follows Logseq, or one of the 38 bundled languages |
| Target language | Dropdown of 142 languages (name + code), defaults to the Logseq language |
| AI provider | Built-in providers → `──── more ────` → models.dev catalogue (235 providers) → custom |
| API key | Stored in this graph's plugin settings |
| Model | Dropdown from models.dev for the selected provider, plus a custom id |
| Endpoint | Filled from the provider automatically; edit it to override, “Reset” restores the default |
| Reasoning effort | “Lowest” (default), provider default, or the levels the model declares |
| Provider & model list | Status line plus a Refresh button (24 h cache in the plugin iframe's localStorage) |

Persisted keys: `engine`, `targetLanguage`, `aiProvider`, `aiApiKey`, `aiModel`, `aiBaseUrl`,
`aiReasoningDepth`, `uiLang`. A 0.1.x install is migrated on first run (`target`, `endpoint`,
`apiKey`, `model`).

## Known constraints

### CORS

Plugins run inside a sandboxed iframe, so every request is an ordinary browser request. A provider
that does not send `Access-Control-Allow-Origin` cannot be used from here — the error message says
so explicitly instead of reporting a generic network failure. Some providers answer errors without
CORS headers, in which case Logseq reports a network failure rather than the provider's message.
Ollama needs `OLLAMA_ORIGINS=*` (or the Logseq origin).

The sandbox also refuses plain-HTTP origins such as `http://localhost`. A local Ollama therefore
has to be reached over an HTTPS endpoint; the default `http://localhost:11434` will not load from
inside the plugin.

### Native settings page

Logseq's schema settings can only render `<option value>label</option>` enums and never refresh a
dependent list in place, which is why the real form is a panel (see above). The native plugin
settings page only carries a heading and, on Logseq ≥ 2.0, a button that opens it. On 0.10.x use the
command palette.

Command and slash-command names follow the interface language that was active when the plugin
loaded; Logseq has no API to rename a registered command, so a language switch updates the panel
immediately but the command names after the next Logseq start.

## Status

Current version: **0.2.0**.

Verified on a real Logseq 2.0.2 instance (driven over the DevTools protocol):

- `npm run verify` — i18n check (38 locales × 74 keys), typecheck, 62 unit tests, build, dist guards.
- `npm run e2e` against the running app: 223 provider options, 142 target languages, provider switch
  → model + endpoint auto-fill, German/Arabic panel text, Arabic `dir=rtl` (`e2e/artifacts/`).
- Google Translate inserts a translated sibling block; page translation creates `<page> · zh-CN`
  with all blocks translated and a persistent progress toast (`1/5 …`) that disappears on success
  and on failure.
- AI path with a real provider: a DeepSeek request with an invalid key surfaces the provider's own
  `Authentication Fails …` message, not `Failed to fetch`.
- 0.1.1 → 0.2.0 settings migration (legacy `target/endpoint/apiKey/model` → new keys; the old
  default endpoint becomes “auto”).

Not verified:

- Local Ollama over plain HTTP is blocked by the sandbox CSP, as described above — use an HTTPS
  endpoint or the AI engine will be unavailable.
- Providers that answer errors without CORS headers (OpenAI's 401 is one) surface a CORS message in
  the plugin; a valid key still works but the failure text is less precise.

## Licence

MPL-2.0. Bundles `@dualtran/core` (MPL-2.0).
