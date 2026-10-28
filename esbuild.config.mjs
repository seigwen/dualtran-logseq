import { build } from "esbuild";

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
console.log("built dist/index.js");
