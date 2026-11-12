#!/usr/bin/env node
/**
 * Payload generator for `scripts/conformance/run.mjs` (conformance.json
 * `payloadCommand`).
 *
 * It runs the vitest conformance suite (which renders the REAL settings panel
 * twice — unconfigured and configured — and validates it) and then emits the
 * same payload as JSON on stdout, so the untouched kit runner can validate it
 * itself: self-test → static scan → spec rules.
 *
 * Kept host-side and separate from the byte-identical kit files.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suite = "tests/conformance/settings.test.ts";

function writeDump(testFile) {
  // A throwaway vitest file that serialises the real payload from the suite.
  const dir = mkdtempSync(join(tmpdir(), "dualtran-payload-"));
  const file = join(dir, "dump.test.ts");
  writeFileSync(
    file,
    [
      "// @vitest-environment jsdom",
      "import { it } from \"vitest\";",
      "import { writeFileSync } from \"node:fs\";",
      `import { buildPayload } from ${JSON.stringify(join(repoRoot, suite.replace(/\.ts$/, "")))};`,
      `it("dump", () => { writeFileSync(${JSON.stringify(join(dir, "payload.json"))}, JSON.stringify(buildPayload())); });`,
      "",
    ].join("\n"),
  );
  const config = join(dir, "vitest.config.mjs");
  writeFileSync(
    config,
    [
      "export default {",
      `  root: ${JSON.stringify(repoRoot)},`,
      "  include: [],",
      "  test: { include: [" + JSON.stringify(file) + "], environment: \"jsdom\" },",
      "};",
      "",
    ].join("\n"),
  );
  try {
    execFileSync(process.execPath, [join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", "--config", config], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return readFileSync(join(dir, "payload.json"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run the gate suite first: a payload that only the CLI validates would let the
 * assertions (R3 override, empty-state negatives) rot unnoticed.
 */
try {
  execFileSync(process.execPath, [join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", suite], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
} catch {
  process.exit(1);
}

process.stdout.write(writeDump(suite));
