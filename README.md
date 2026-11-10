# DualTran Translate for Logseq

**Read foreign notes without losing the source.** Select a block, run *Translate block (below)*,
and the translation is inserted as the next block — the original stays exactly where it was.

Two engines:

- **Google Translate** — no key, no configuration, works out of the box
- **AI** — any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Moonshot, local Ollama,
  …) with your own key; the key is stored in this graph's settings only

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
| Slash menu | `Translate block (below)` | Translates the current block, inserts the result as a sibling |
| Slash menu | `Translate page to a new page` | Translates every block into a new page named `<page> · <lang>` |
| Command palette | `DualTran: translate block below` | Same as the first |

## Settings

| Key | Default | Notes |
|---|---|---|
| `engine` | `google` | `google` or `ai` |
| `target` | `zh-CN` | any language code |
| `endpoint` | `https://api.openai.com/v1` | base URL; `/chat/completions` is appended when missing |
| `apiKey` | empty | bearer token |
| `model` | `gpt-4o-mini` | model id for the endpoint |

## Known constraint: CORS and HTTPS

Plugins run inside a sandboxed iframe, so every request is an ordinary browser request.
A provider that does not send `Access-Control-Allow-Origin` cannot be used from here — the
error message says so explicitly instead of reporting a generic network failure. Ollama needs
`OLLAMA_ORIGINS=*` (or the Logseq origin) to answer.

The sandbox also refuses plain-HTTP origins such as `http://localhost`. A local Ollama therefore
has to be reached over an HTTPS endpoint; the default `http://localhost:11434` will not load from
inside the plugin.

## Status

Current version: **0.1.1 (beta)**.

Verified:

- `npm run build` succeeds and emits `dist/index.js` + `dist/index.html`.
- `npm test` passes — 16 unit tests covering endpoint normalisation, request building, response
  parsing, chunking and the CORS error text.
- The plugin has been loaded in **Logseq 2.0.2** (headless, driven over CDP). The console showed
  `entry normalized ... dist/index.html`, `sandbox connected` and `load:done in 123.3ms`.
- Google Translate requests from inside the plugin sandbox return HTTP 200.

Not yet verified:

- The slash commands have **not** been exercised end-to-end in a GUI session. The block-insertion
  path (`Translate block (below)` writing a sibling block) still needs one manual run in a Logseq
  window before it can be called verified.
- Local Ollama over plain HTTP is blocked by the sandbox CSP, as described above — use an HTTPS
  endpoint or the AI engine will be unavailable.

Until that GUI run happens, treat 0.1.x as a beta and report what breaks.

## Licence

MPL-2.0.
