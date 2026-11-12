// @vitest-environment jsdom
/**
 * Host conformance gate (SPEC 2.1.0).
 *
 * This test renders the real settings panel twice — unconfigured (fresh
 * install: provider `""`) and configured — reads the real controls and feeds
 * them to the shared validator. It is deliberately not a copy of the product
 * logic: if the panel regresses (divider back, free-text target, endpoint only
 * in a placeholder, an OpenAI fallback in the empty state), the payload changes
 * and the validator fails.
 *
 * The same generator produces the JSON the CLI runner consumes
 * (`scripts/conformance/run.mjs` -> `buildPayload`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderSettingsPanel } from "../../src/ui";
import { DEFAULT_SETTINGS, LOWEST_REASONING, type DualTranSettings } from "../../src/settings";
import {
  CUSTOM_PROVIDER,
  modelsForProvider,
  projectProviders,
  resolveReasoningDepth,
  type ModelsDevData,
  type ModelOption,
  type ProviderDef,
} from "../../src/catalog";
// @ts-expect-error — plain ESM kit, shared byte-for-byte across hosts
import { selfTest, validatePayload } from "../../scripts/conformance/validate.mjs";
// @ts-expect-error — plain ESM kit
import { scanFiles } from "../../scripts/conformance/scan.mjs";

const repoRoot = resolve(__dirname, "../..");

const builtIns: ProviderDef[] = [
  { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", apiBase: "https://api.anthropic.com/v1" },
  { id: "google-gemini", name: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "moonshot", name: "Moonshot", apiBase: "https://api.moonshot.cn/v1" },
  { id: "deepseek", name: "DeepSeek", apiBase: "https://api.deepseek.com/v1" },
  { id: "groq", name: "Groq", apiBase: "https://api.groq.com/openai/v1" },
];

const aliases: Record<string, string> = {
  "google-gemini": "google",
  moonshot: "moonshotai",
  grok: "xai",
};
const resolveId = (id: string): string => aliases[id] || id;

const data: ModelsDevData = {
  openai: {
    api: "https://api.openai.com/v1",
    models: {
      "gpt-4.1": { name: "GPT-4.1", reasoning_options: [{ type: "effort", values: ["none", "minimal", "low", "medium", "high"] }] },
      "gpt-4.1-mini": { name: "GPT-4.1 Mini" },
    },
  },
  anthropic: {
    api: "https://api.anthropic.com/v1",
    models: { "anthropic-test-model": { name: "Anthropic Test Reasoner", reasoning_options: [{ type: "effort", values: ["low", "medium"] }] } },
  },
  google: {
    api: "https://generativelanguage.googleapis.com/v1beta",
    models: { "gemini-2.5-pro": { name: "Gemini 2.5 Pro" } },
  },
  deepseek: {
    api: "https://api.deepseek.com/v1",
    models: { "deepseek-chat": { name: "DeepSeek Chat", reasoning_options: [{ type: "effort", values: ["low", "medium"] }] } },
  },
  groq: {
    api: "https://api.groq.com/openai/v1",
    models: { "llama-3.3-70b": { name: "Llama 3.3 70B" } },
  },
  mistral: {
    api: "https://api.mistral.ai/v1",
    models: { "mistral-large": { name: "Mistral Large" } },
  },
  together: {
    api: "https://api.together.xyz/v1",
    models: { "qwen-72b": { name: "Qwen 72B" } },
  },
  openrouter: {
    api: "https://openrouter.ai/api/v1",
    models: { "openrouter/auto": { name: "Auto" } },
  },
};

function languageNames(): Record<string, string> {
  const names: Record<string, string> = {
    en: "English",
    "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    ru: "Russian",
    it: "Italian",
    ar: "Arabic",
    hi: "Hindi",
    th: "Thai",
    vi: "Vietnamese",
    id: "Indonesian",
    tr: "Turkish",
    nl: "Dutch",
    pl: "Polish",
    uk: "Ukrainian",
  };
  for (let i = 0; i < 25; i += 1) names[`x${i}`] = `Language ${i}`;
  return names;
}

function localeFiles(): { locales: string[]; keys: string[]; files: Record<string, Record<string, string>> } {
  const dir = join(repoRoot, "locales");
  const locales = readdirSync(dir).filter((entry) => {
    try {
      return statSync(join(dir, entry)).isDirectory() && existsSync(join(dir, entry, "messages.json"));
    } catch {
      return false;
    }
  });
  const raw = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(readFileSync(join(dir, locale, "messages.json"), "utf8"))])
  ) as Record<string, Record<string, { message?: string } | string>>;
  const files = Object.fromEntries(
    Object.entries(raw).map(([locale, messages]) => [
      locale,
      Object.fromEntries(
        Object.entries(messages).map(([key, entry]) => [key, typeof entry === "string" ? entry : entry?.message || ""])
      ),
    ])
  ) as Record<string, Record<string, string>>;
  return { locales: [...locales].sort(), keys: Object.keys(files.en || {}), files };
}

function readSelect(root: HTMLElement, name: string): HTMLSelectElement {
  const element = root.querySelector<HTMLSelectElement>(`select[data-dt="${name}"]`);
  if (!element) throw new Error(`settings panel has no select[data-dt="${name}"]`);
  return element;
}

function readInput(root: HTMLElement, name: string): HTMLInputElement {
  const element = root.querySelector<HTMLInputElement>(`input[data-dt="${name}"]`);
  if (!element) throw new Error(`settings panel has no input[data-dt="${name}"]`);
  return element;
}

function optionsOf(select: HTMLSelectElement): Array<{ value: string; label: string; disabled: boolean; selected: boolean }> {
  return Array.from(select.options).map((option) => ({
    value: option.value,
    label: option.textContent?.trim() || option.value,
    disabled: option.disabled,
    selected: option.selected,
  }));
}

/** Mount the real panel over a mutable settings object; returns it with the update log. */
function mountPanel(initial: Partial<DualTranSettings>) {
  const settings = { ...DEFAULT_SETTINGS, engine: "ai" as const, targetLanguage: "zh-CN", ...initial };
  const updates: Array<Record<string, unknown>> = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderSettingsPanel(host, {
    t: (key: string, subs?: Record<string, string | number>) => {
      const messages = localeFiles().files.en || {};
      let text = String(messages[key] || key);
      for (const [name, value] of Object.entries(subs || {})) {
        text = text.replace(`{${name}}`, String(value)).replace(`$${name}$`, String(value));
      }
      return text;
    },
    locale: "en",
    version: "conformance",
    getSettings: () => settings,
    update: (patch: Record<string, unknown>) => {
      updates.push(patch);
      Object.assign(settings, patch);
    },
    catalog: () => data,
    catalogState: () => "ready" as const,
    refreshCatalog: async () => undefined,
    languageNames,
    builtIns,
    resolveId,
    smartDefault: () => null,
    reasoningOptions: (provider: string, model: string) => {
      const record = data[resolveId(provider)]?.models?.[model];
      const effort = (record?.reasoning_options || []).find((entry) => entry?.type === "effort");
      return (effort?.values || []).map((value) => ({ value, label: value }));
    },
    close: () => undefined,
    rerender: () => undefined,
  });
  return { host, settings, updates };
}

function reasoningSection(reasoning: HTMLSelectElement) {
  return {
    control: "select" as const,
    disabled: reasoning.disabled,
    default: reasoning.value,
    options: optionsOf(reasoning).map(({ value, label }) => ({ value, label })),
  };
}

const resolveCase = (values: string[]) => ({
  setting: LOWEST_REASONING,
  options: values.map((value) => ({ value })),
  value: resolveReasoningDepth({ setting: LOWEST_REASONING, options: values.map((value) => ({ value })) }),
});

function resolvedCases() {
  return {
    none: [resolveCase(["none", "minimal", "low"])],
    minimal: [resolveCase(["minimal", "low"])],
    low: [resolveCase(["low", "medium"])],
    "none-declared": [resolveCase([])],
  };
}

function providerOptionsOf(select: HTMLSelectElement, selectedId: string) {
  const providers = projectProviders({ data, builtIns, selectedId, resolveId });
  const sourceById = new Map(providers.map((provider) => [provider.id, provider.source]));
  return optionsOf(select)
    .filter((option) => option.value !== "")
    .map((option) => ({
      ...option,
      source: sourceById.get(option.value) || (option.value === CUSTOM_PROVIDER ? "custom" : "models.dev"),
    }));
}

function byProviderOf(selectedId: string) {
  const providers = projectProviders({ data, builtIns, selectedId, resolveId });
  const byProvider: Record<string, Array<{ value: string; label: string }>> = {};
  for (const provider of providers) {
    if (provider.id === CUSTOM_PROVIDER) continue;
    const models = modelsForProvider({ provider: provider.id, data, resolveId });
    if (models.length) byProvider[provider.id] = models.map((model: ModelOption) => ({ value: model.value, label: model.text }));
  }
  return byProvider;
}

export function buildPayload(): Record<string, unknown> {
  // ── Unconfigured: the panel over a fresh install ──────────────────────────
  const fresh = mountPanel({ aiProvider: "", aiModel: "", aiApiKey: "", aiBaseUrl: "" });
  const freshProvider = readSelect(fresh.host, "provider");
  const freshModel = readSelect(fresh.host, "model");
  const freshEndpoint = readInput(fresh.host, "endpoint");
  const freshReasoning = readSelect(fresh.host, "reasoning");
  const freshTarget = readSelect(fresh.host, "target");

  const placeholder = optionsOf(freshProvider).find((option) => option.value === "");
  const freshProviderSection = {
    control: "select",
    current: fresh.settings.aiProvider,
    placeholder: placeholder
      ? { value: placeholder.value, label: placeholder.label, disabled: placeholder.disabled, selected: placeholder.selected }
      : null,
    fallback: "",
    options: providerOptionsOf(freshProvider, fresh.settings.aiProvider),
  };
  // The disabled pickers carry their explanation as a single disabled option
  // (native HTML has no placeholder attribute for <select>), so a non-empty
  // option list here means the panel invented a choice the user did not make.
  const modelPlaceholderOptions =
    freshModel.disabled && !fresh.settings.aiProvider
      ? optionsOf(freshModel).map(({ value, label, disabled }) => ({ value, label, disabled }))
      : [];
  const emptySnapshot = {
    providerCurrent: fresh.settings.aiProvider,
    providerValue: freshProvider.value,
    modelDisabled: freshModel.disabled,
    modelValue: freshModel.value,
    modelOptions: modelPlaceholderOptions,
    modelSelectedProvider: freshModel.disabled ? "" : fresh.settings.aiProvider,
    modelSelectedModel: freshModel.disabled ? "" : fresh.settings.aiModel,
    endpointValue: freshEndpoint.value,
    endpointPlaceholder: freshEndpoint.placeholder,
    reasoningDisabled: freshReasoning.disabled,
    reasoningValue: freshReasoning.value,
    html: fresh.host.innerHTML,
  };
  const languageSection = {
    control: "select",
    current: fresh.settings.targetLanguage,
    options: optionsOf(freshTarget).map(({ value, label }) => ({ value, label })),
  };

  // ── R3: choose a provider on the SAME panel and read what the handler wrote ─
  freshProvider.value = "anthropic";
  freshProvider.dispatchEvent(new Event("change"));
  const afterPick = String(fresh.updates[fresh.updates.length - 1]?.aiBaseUrl ?? "");

  // User override must survive a later provider switch.
  fresh.settings.aiBaseUrl = "https://proxy.example/v1";
  freshProvider.value = "deepseek";
  freshProvider.dispatchEvent(new Event("change"));
  const afterSwitch = String(fresh.updates[fresh.updates.length - 1]?.aiBaseUrl ?? "");

  // ── Configured: re-render from what the handler actually wrote ────────────
  const configured = mountPanel({ aiProvider: "anthropic", aiModel: "anthropic-test-model", aiApiKey: "sk-x", aiBaseUrl: "" });
  const providerSelect = readSelect(configured.host, "provider");
  const modelSelect = readSelect(configured.host, "model");
  const endpointInput = readInput(configured.host, "endpoint");
  const reasoningSelect = readSelect(configured.host, "reasoning");
  // No placeholder row exists once a provider is chosen (the disabled empty
  // entry is a one-way door, so there is never a "None" item to go back to);
  // SPEC 2.1's configured example spells that as selected:false.
  const configuredPlaceholderRow = optionsOf(providerSelect).find((option) => option.value === "");
  const configuredPlaceholder = {
    value: "",
    label: "Select a provider",
    disabled: true,
    selected: configuredPlaceholderRow?.selected === true,
  };
  const configuredSnapshot = {
    providerCurrent: configured.settings.aiProvider,
    providerValue: providerSelect.value,
    placeholderSelected: configuredPlaceholder?.selected ?? false,
    modelDisabled: modelSelect.disabled,
    modelValue: modelSelect.value,
    modelSelectedProvider: modelSelect.disabled ? "" : configured.settings.aiProvider,
    modelSelectedModel: modelSelect.disabled ? "" : configured.settings.aiModel,
    endpointValue: endpointInput.value,
    reasoningDisabled: reasoningSelect.disabled,
  };

  const i18n = localeFiles();
  return {
    spec: "2.1.0",
    host: "dualtran-logseq",
    language: languageSection,
    // Kept for hosts that read one provider section: the default state is empty.
    provider: freshProviderSection,
    model: {
      control: "select",
      disabled: emptySnapshot.modelDisabled,
      selectedProvider: emptySnapshot.modelSelectedProvider,
      selectedModel: emptySnapshot.modelSelectedModel,
      // SPEC 2.1's empty-state example spells `options: []`; the panel's one
      // disabled entry is reported as `placeholder` (it is not a real model).
      placeholder: emptySnapshot.modelOptions[0] || null,
      options: [],
      byProvider: byProviderOf(fresh.settings.aiProvider),
    },
    endpoint: {
      control: "input",
      current: emptySnapshot.endpointValue,
      placeholder: emptySnapshot.endpointPlaceholder,
      autofill: {
        provider: "anthropic",
        before: emptySnapshot.endpointValue,
        after: afterPick,
        providerApi: "https://api.anthropic.com/v1",
        userEdited: "https://proxy.example/v1",
        afterSwitch,
      },
    },
    reasoning: {
      ...reasoningSection(freshReasoning),
      resolved: resolvedCases(),
    },
    states: {
      unconfigured: {
        provider: freshProviderSection,
        model: {
          control: "select",
          disabled: emptySnapshot.modelDisabled,
          selectedProvider: emptySnapshot.modelSelectedProvider,
          selectedModel: emptySnapshot.modelSelectedModel,
          placeholder: emptySnapshot.modelOptions[0] || null,
          options: [],
        },
        endpoint: { control: "input", current: emptySnapshot.endpointValue, placeholder: emptySnapshot.endpointPlaceholder },
        reasoning: reasoningSection(freshReasoning),
      },
      configured: {
        provider: {
          control: "select",
          current: configuredSnapshot.providerCurrent,
          placeholder: configuredPlaceholder,
          fallback: "",
          options: providerOptionsOf(providerSelect, configured.settings.aiProvider),
        },
        model: {
          control: "select",
          disabled: configuredSnapshot.modelDisabled,
          selectedProvider: configuredSnapshot.modelSelectedProvider,
          selectedModel: configuredSnapshot.modelSelectedModel,
          options: optionsOf(modelSelect)
            .filter((option) => option.value !== "__custom__")
            .map(({ value, label }) => ({ value, label })),
        },
        endpoint: { control: "input", current: configuredSnapshot.endpointValue },
        reasoning: reasoningSection(reasoningSelect),
      },
    },
    i18n: {
      locales: i18n.locales,
      keys: i18n.keys,
      sourceLocale: "en",
      files: i18n.files,
      used: [
        "settingProvider",
        "providerPlaceholder",
        "providerRequiredForModel",
        "providerRequiredError",
        "settingModel",
        "settingEndpoint",
        "settingReasoning",
        "btnResetEndpoint",
      ],
    },
    static: {
      hits: scanFiles(repoRoot, {
        files: ["src/ui.ts", "src/catalog.ts", "src/settings.ts", "src/bridge.ts"],
        patterns: [
          "providerSeparator",
          "__separator__",
          "__more__",
          "More (models.dev)",
          // SPEC 2.1: no silent OpenAI / custom-provider fallback on a request
          // path (`provider || "openai"`, `? aiProvider : CUSTOM_PROVIDER`, …).
          { token: '|| "openai"', regex: '\\|\\|\\s*["\']openai["\']' },
          { token: '|| "anthropic"', regex: '\\|\\|\\s*["\']anthropic["\']' },
          { token: '? aiProvider : CUSTOM_PROVIDER', regex: '\\?\\s*[\\w.]+\\s*:\\s*CUSTOM_PROVIDER' },
          { token: '|| CUSTOM_PROVIDER', regex: '\\|\\|\\s*CUSTOM_PROVIDER[\\s),;]' },
        ],
      }),
    },
  };
}

export default buildPayload;

describe("host conformance (SPEC 2.1.0)", () => {
  it("kit negative controls still fail", () => {
    expect(selfTest()).toBeGreaterThan(0);
  });

  it("settings panel satisfies the product rules, configured and unconfigured", () => {
    const payload = buildPayload();
    const summary = validatePayload(payload, {});
    expect(summary.host).toBe("dualtran-logseq");
    expect(summary.providers).toBeGreaterThanOrEqual(5);
  });

  it("exposes the unconfigured state exactly as SPEC 2.1 requires", () => {
    const payload = buildPayload() as Record<string, any>;
    const empty = payload.states.unconfigured;
    expect(empty.provider.current).toBe("");
    expect(empty.provider.placeholder).toEqual({
      value: "",
      label: "Select a provider",
      disabled: true,
      selected: true,
    });
    expect(empty.provider.fallback).toBe("");
    expect(empty.provider.options.every((option: { value: string }) => option.value !== "")).toBe(true);
    expect(empty.model.disabled).toBe(true);
    expect(empty.model.selectedProvider).toBe("");
    expect(empty.model.selectedModel).toBe("");
    expect(empty.model.options).toEqual([]);
    expect(empty.model.placeholder).toEqual({ value: "", label: "Select a provider first", disabled: true });
    expect(empty.endpoint).toEqual({ control: "input", current: "", placeholder: "https://" });
    expect(empty.reasoning.disabled).toBe(true);
    expect(empty.reasoning.default).toBe(LOWEST_REASONING);
    expect(JSON.stringify(empty)).not.toMatch(/api\.openai\.com|gpt-/i);

    const configured = payload.states.configured;
    expect(configured.provider.current).toBe("anthropic");
    expect(configured.provider.placeholder.selected).toBe(false);
    expect(configured.model.disabled).toBe(false);
    expect(configured.model.selectedProvider).toBe("anthropic");
    expect(configured.endpoint.current).toBe("https://api.anthropic.com/v1");
    expect(configured.reasoning.disabled).toBe(false);
  });

  it("ships the three provider keys in every locale", () => {
    const payload = buildPayload() as Record<string, any>;
    const en = payload.i18n.files.en;
    expect(en.providerPlaceholder).toBe("Select a provider");
    expect(en.providerRequiredForModel).toBe("Select a provider first");
    expect(en.providerRequiredError).toBe("Choose an AI provider in settings before translating.");
    const zh = payload.i18n.files.zh_CN;
    expect(zh.providerPlaceholder).toBe("请选择 AI 提供商");
    expect(zh.providerRequiredForModel).toBe("请先选择提供商");
    expect(zh.providerRequiredError).toBe("翻译前请先在设置中选择 AI 提供商。");
    for (const locale of payload.i18n.locales) {
      for (const key of ["providerPlaceholder", "providerRequiredForModel", "providerRequiredError"]) {
        expect(payload.i18n.files[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});
