#!/usr/bin/env node
/**
 * Build-artifact guards for the Logseq plugin.
 *
 * These run after `npm run build` and fail the release when a host-incompatible
 * artifact would ship: Node built-ins in a sandboxed iframe, a stale version
 * banner, a missing locale, or a bundle that blew past a sane size.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const bundlePath = path.join(ROOT, "dist", "index.js");
check(fs.existsSync(bundlePath), "dist/index.js is missing — run npm run build");
const bundle = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, "utf8") : "";
const html = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8");

check(bundle.includes(`v${pkg.version}`), `bundle banner does not mention v${pkg.version}`);
check(!/node:(fs|path)/.test(bundle), "bundle still references a Node built-in (node:fs / node:path)");
check(bundle.length < 4 * 1024 * 1024, `bundle is ${(bundle.length / 1024 / 1024).toFixed(1)} MB (> 4 MB)`);
check(html.includes('src="index.js"'), "dist/index.html does not load index.js");
check(pkg.logseq && pkg.logseq.main === "dist/index.html", "package.json logseq.main must be dist/index.html");
check(pkg.logseq && pkg.logseq.id === "dualtran-translate", "package.json logseq.id must stay dualtran-translate");

const localesDir = path.join(ROOT, "locales");
const locales = fs.readdirSync(localesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
check(locales.length === 38, `expected 38 locales, found ${locales.length}`);
for (const entry of locales) {
  const file = path.join(localesDir, entry.name, "messages.json");
  check(fs.existsSync(file), `locales/${entry.name}/messages.json is missing`);
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    check(Object.keys(parsed).length > 40, `locales/${entry.name} looks incomplete (${Object.keys(parsed).length} keys)`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
  process.exit(1);
}
console.log(
  `[guards] ok — v${pkg.version}, ${(bundle.length / 1024).toFixed(0)} KB bundle, ${locales.length} locales`,
);
