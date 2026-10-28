import { build } from "esbuild";
import fs from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "iife",
  target: "es2020",
  platform: "browser",
  minify: false,
  sourcemap: false,
  external: [],
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
console.log("built dist/index.js and dist/index.html");
