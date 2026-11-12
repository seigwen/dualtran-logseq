#!/usr/bin/env node
/**
 * Real-Logseq e2e for the settings panel.
 *
 * Requires a running Logseq (2.0.x) with this plugin installed/enabled and
 * CDP exposed:
 *
 *   logseq --remote-debugging-port=9224 --remote-allow-origins=*
 *
 * Opens the panel through the *user* path (command palette), then asserts the
 * things the unit suite cannot see: real dropdown population from models.dev,
 * provider→model→endpoint wiring, persistence and localized/RTL rendering.
 * Expected i18n strings are read from locales/<code>/messages.json.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDP, sleep } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = path.join(ROOT, "e2e", "artifacts");
const PLUGIN_ID = "dualtran-translate";

function message(code, key) {
  const file = path.join(ROOT, "locales", code, "messages.json");
  return JSON.parse(fs.readFileSync(file, "utf8"))[key].message;
}

async function openPanel(page) {
  await page.evaluate("document.body.focus()");
  await page.key("k", "KeyK", 75, 2); // Ctrl+Shift+K
  await sleep(700);
  await page.insertText("DualTran: settings");
  await sleep(900);
  const rect = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.search-results')];
    const row = rows.find((entry) => (entry.textContent || '').trim().startsWith('DualTran: settings'));
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  assert.ok(rect, "command palette did not offer 'DualTran: settings'");
  await page.click(rect.x, rect.y);
  await sleep(1600);
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const page = await CDP.connect({ type: "page" });
  const plugin = await CDP.connect({ type: "iframe", match: PLUGIN_ID });
  await page.call("Page.enable");

  // Start from a closed panel.
  await plugin.evaluate("(() => { logseq.hideMainUI(); return 1 })()");
  await sleep(400);

  await openPanel(page);

  const snapshot = await plugin.evaluate(`(() => {
    const q = (key) => document.querySelector('[data-dt="' + key + '"]');
    const provider = q('provider');
    const placeholder = provider ? [...provider.options].find((option) => option.value === '') : null;
    return {
      panel: !!document.querySelector('.dt-panel'),
      controls: ['engine', 'uiLang', 'target', 'provider', 'model', 'reasoning'].filter((key) => !!q(key)),
      provider: logseq.settings.aiProvider,
      placeholder: placeholder
        ? { label: placeholder.textContent, disabled: placeholder.disabled, selected: placeholder.selected }
        : null,
      providerCount: provider ? provider.options.length : 0,
      providerLabels: provider
        ? [...provider.options]
            .filter((option) => option.value !== '')
            .slice(0, -1)
            .map((option) => option.textContent)
        : [],
      providerGroups: provider ? provider.querySelectorAll('optgroup').length : 0,
      lastProvider: provider ? provider.options[provider.options.length - 1].value : '',
      targetCount: q('target') ? q('target').options.length : 0,
      targetHasZh: q('target') ? [...q('target').options].some((option) => option.value === 'zh-CN') : false,
      modelCount: q('model') ? q('model').options.length : 0,
      modelDisabled: q('model') ? q('model').disabled : false,
      modelLabel: q('model') && q('model').options[0] ? q('model').options[0].textContent : '',
      reasoningDisabled: q('reasoning') ? q('reasoning').disabled : false,
      endpoint: q('endpoint') ? q('endpoint').value : '',
      endpointPlaceholder: q('endpoint') ? q('endpoint').placeholder : '',
      catalogStatus: document.querySelector('[data-dt="catalogStatus"]')?.textContent || '',
    };
  })()`);

  assert.equal(snapshot.panel, true, "settings panel did not open");
  assert.deepEqual(snapshot.controls, ["engine", "uiLang", "target", "provider", "model", "reasoning"]);
  assert.ok(snapshot.providerCount > 100, `provider dropdown has only ${snapshot.providerCount} options`);
  assert.equal(snapshot.providerGroups, 0, "provider dropdown must not be grouped");
  const sortedLabels = [...snapshot.providerLabels].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(snapshot.providerLabels, sortedLabels, "provider list is not alphabetical");
  assert.equal(snapshot.lastProvider, "__custom_provider__", "custom provider must be last");
  assert.ok(snapshot.targetCount >= 140, `target language dropdown has only ${snapshot.targetCount} options`);
  assert.equal(snapshot.targetHasZh, true, "target language dropdown is missing zh-CN");
  assert.match(snapshot.catalogStatus, /providers|Loading|unavailable/);

  // SPEC 2.1: an unconfigured install has no provider. The placeholder is a
  // disabled, selected entry with an empty value, and every dependent control
  // is empty/disabled instead of advertising OpenAI.
  if (!snapshot.provider) {
    assert.deepEqual(snapshot.placeholder, {
      label: message("en", "providerPlaceholder"),
      disabled: true,
      selected: true,
    }, "unconfigured provider picker is missing its disabled placeholder");
    assert.equal(snapshot.modelDisabled, true, "model picker must be disabled while unconfigured");
    assert.equal(snapshot.modelLabel, message("en", "providerRequiredForModel"), "model picker placeholder text");
    assert.equal(snapshot.reasoningDisabled, true, "reasoning picker must be disabled while unconfigured");
    assert.equal(snapshot.endpoint, "", "endpoint must be empty while unconfigured");
    assert.equal(snapshot.endpointPlaceholder, "https://", "endpoint placeholder must be https://");
  } else {
    assert.ok(snapshot.modelCount > 1, "model dropdown is empty");
    assert.match(snapshot.endpoint, /^https:\/\//, "endpoint was not filled from the provider");
  }

  // Provider switch: pick a known catalogue provider.
  const switched = await plugin.evaluate(`(async () => {
    const provider = document.querySelector('[data-dt="provider"]');
    const options = [...provider.options].filter((option) => option.value !== '__custom_provider__');
    const next = options.find((option) => option.value === '302ai') || options[Math.floor(options.length / 2)];
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(provider, next.value);
    provider.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      provider: logseq.settings.aiProvider,
      model: logseq.settings.aiModel,
      baseUrl: logseq.settings.aiBaseUrl,
      modelCount: document.querySelector('[data-dt="model"]').options.length,
      endpoint: document.querySelector('[data-dt="endpoint"]').value,
    };
  })()`);
  assert.equal(switched.provider !== "openai", true, "provider did not change");
  assert.ok(switched.model.length > 0, "model was not picked for the new provider");
  assert.ok(switched.modelCount > 0, "model dropdown did not repopulate");
  assert.equal(switched.endpoint, switched.baseUrl, "endpoint input does not show the persisted base URL");
  assert.match(switched.baseUrl, /^https:\/\//, "endpoint was not auto-filled after the provider switch");

  // UI language: German renders the German catalogue value, Arabic is RTL.
  const german = await plugin.evaluate(`(async () => {
    const select = document.querySelector('[data-dt="uiLang"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'de');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { title: document.querySelector('.dt-head h1').textContent, uiLang: logseq.settings.uiLang };
  })()`);
  assert.equal(german.uiLang, "de");
  assert.equal(german.title, message("de", "panelTitle"), "panel title is not German");

  const arabic = await plugin.evaluate(`(async () => {
    const select = document.querySelector('[data-dt="uiLang"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'ar');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      title: document.querySelector('.dt-head h1').textContent,
      dir: document.querySelector('.dt-panel').getAttribute('dir'),
    };
  })()`);
  assert.equal(arabic.title, message("ar", "panelTitle"), "panel title is not Arabic");
  assert.equal(arabic.dir, "rtl", "Arabic panel is not RTL");

  await page.screenshot(path.join(ARTIFACTS, "settings-panel-ar.png"));

  // Reset the interface language and close.
  await plugin.evaluate(`(() => {
    logseq.updateSettings({ uiLang: '' });
    logseq.hideMainUI();
    document.getElementById('dualtran-settings-root')?.remove();
    return 1;
  })()`);

  console.log(
    `[e2e] ok — ${snapshot.providerCount} providers, ${snapshot.targetCount} languages, ${snapshot.modelCount} models; ` +
      `switch ${switched.provider}/${switched.model}; de+ar localized; RTL ok`,
  );
  page.close();
  plugin.close();
}

main().catch((error) => {
  console.error(`[e2e] FAILED — ${error.message}`);
  process.exit(1);
});
