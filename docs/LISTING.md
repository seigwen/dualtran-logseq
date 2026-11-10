# Marketplace listing — current state

Checked on **2026-11-10** against a shallow clone of `logseq/marketplace` (`master`).

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
`icon` — the plugin id (`dualtran-translate`) and the entry point (`dist/index.html`) come from the
`logseq` block of `package.json` inside the linked repo.

## Verification boundary

The same boundary stated in the plugin README applies to anything published from this listing:

Verified:

- Build passes (`npm run build` → `dist/index.js`, `dist/index.html`).
- 16 unit tests pass (`npm test`).
- Loaded in Logseq 2.0.2 headless over CDP — console showed `entry normalized ... dist/index.html`,
  `sandbox connected`, `load:done in 123.3ms`.
- Google Translate endpoints return HTTP 200 from inside the plugin sandbox.

Not verified:

- Slash-command block insertion has not been run end-to-end in a GUI Logseq window. Until it has,
  the marketplace description should not claim the slash commands are verified.
- The sandbox CSP blocks `http://localhost`, so a local Ollama instance is only reachable over an
  HTTPS endpoint.

Release status: 0.1.x is beta.
