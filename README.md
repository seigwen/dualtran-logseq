# DualTran Translate for Logseq

**Read foreign notes without losing the source.** Select a block, run *Translate block (below)*,
and the translation is inserted as the next block — the original stays exactly where it was.

Two engines:

- **Google Translate** — no key, no configuration, works out of the box
- **AI** — any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Moonshot, local Ollama,
  …) with your own key; the key is stored in this graph's settings only

## Install (development build)

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

## Known constraint: CORS

Plugins run inside a sandboxed iframe, so every request is an ordinary browser request.
A provider that does not send `Access-Control-Allow-Origin` cannot be used from here — the
error message says so explicitly instead of reporting a generic network failure. Ollama needs
`OLLAMA_ORIGINS=*` (or the Logseq origin) to answer.

## Status

- 16 unit tests cover endpoint normalisation, request building, response parsing, chunking and
  the CORS error text (`npm test`).
- **Not yet verified inside the Logseq app** — the build and the core logic are tested, but the
  slash commands have not been exercised against a running graph. Treat 0.1.0 as a beta and
  report what breaks.

## Licence

MPL-2.0.
