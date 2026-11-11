# Marketplace listing — current state

Checked on **2026-11-11** against a shallow clone of `logseq/marketplace` (`master`).

## Listing

| Field | Value |
|---|---|
| Package path | `packages/DualTran` |
| Title | DualTran Translate |
| Repo (from `manifest.json`) | `seigwen/dualtran-logseq` |
| Author | seigwen |
| Icon | `icon.png` (present at `packages/DualTran/icon.png`) |
| Marketplace source | https://github.com/logseq/marketplace/tree/master/packages/DualTran |

The listing already exists in the marketplace repository. Do not open a second package or a
duplicate pull request; changes to the listing go through a PR touching
`packages/DualTran/manifest.json`.

The manifest in the marketplace repo carries only `title`, `description`, `author`, `repo` and
`icon` — the plugin id (`dualtran-translate`), the version and the entry point (`dist/index.html`)
come from the `logseq` block / `version` of `package.json` inside the linked repo. Shipping a
release therefore means committing the built `dist/` + `package.json` to the repo; no marketplace
PR is needed for a version bump.

## Verification boundary (0.2.0)

Verified:

- `npm run verify` passes: 38 locale catalogues (74 keys each), `tsc --noEmit`, 62 unit tests,
  esbuild bundle (2.1 MB), dist guards (`node:`-free, banner version, locale completeness).
- Real Logseq 2.0.2 over CDP: settings panel opens from the command palette and from the native
  settings button; 223 provider options (built-in → disabled divider → models.dev → custom), 142
  target languages, provider switch re-populates models and auto-fills the endpoint; German and
  Arabic UI strings render; Arabic panel is `dir=rtl`.
- Google Translate: block translation inserts the translated sibling block; page translation
  creates `<page> · <lang>` and shows a persistent `1/5 …` progress toast that is removed on
  success and on failure.
- AI: DeepSeek with an invalid key surfaces the provider's `Authentication Fails …` message.
- 0.1.1 settings migrate to the 0.2.0 keys on first load.

Not verified:

- Local Ollama over plain HTTP is blocked by the sandbox CSP (platform limit).
- Error responses without CORS headers (e.g. OpenAI 401) surface as a network failure in Logseq.

Release status: 0.2.0.
