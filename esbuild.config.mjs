import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Logseq's plugin iframe has no Node built-ins. @dualtran/core ships a Node-only
 * file cache (node:fs / node:path) this host never uses; stub those two modules
 * so the bundle stays loadable. tests/dist/guards.mjs asserts no node:
 * references survive into dist/index.js.
 */
const nodeBuiltinStubPlugin = {
  name: "node-builtin-stub",
  setup(build) {
    build.onResolve({ filter: /^node:(fs|path)$/ }, (args) => ({ path: args.path, namespace: "node-stub" }));
    build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
      loader: "js",
      contents: `
        // The message deliberately avoids the module specifier so the guard can
        // assert that no node: reference survives in the built bundle.
        const unavailable = () => { throw new Error("DualTran: a Node built-in module is not available on this host."); };
        export const readFileSync = unavailable;
        export const writeFileSync = unavailable;
        export const mkdirSync = unavailable;
        export const dirname = (p) => String(p).split("/").slice(0, -1).join("/") || ".";
        export default {};
      `,
    }));
  },
};

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "iife",
  target: "es2020",
  platform: "browser",
  minify: true,
  sourcemap: false,
  banner: {
    js: `/* DualTran Translate v${pkg.version} — bundles @dualtran/core (MPL-2.0, https://github.com/seigwen/DualTran-extension). */`,
  },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  plugins: [nodeBuiltinStubPlugin],
  logLevel: "info",
});

// Logseq resolves `logseq.main` relative to the plugin root and loads that document in the
// plugin sandbox. The official samples point at `dist/index.html`, so the built document has
// to live inside dist/ with a relative script tag — a root-level index.html is not picked up
// (the loader logs "load:skip (no entry - theme-only package)").
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(
  "dist/index.html",
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>DualTran Translate</title></head>
<body><script src="index.js"></script></body>
</html>
`,
);
console.log(`built dist/index.js and dist/index.html (v${pkg.version})`);
