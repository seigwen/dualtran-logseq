/**
 * Minimal ambient declaration — the vendored core ships an untyped ESM bundle
 * (see scripts/sync-core.mjs). Structural interfaces live in src/bridge.ts and
 * src/catalog.ts; only this module needs the module declaration.
 */
declare module "dualtran";
