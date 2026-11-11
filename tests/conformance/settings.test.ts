// @vitest-environment jsdom
/**
 * Host conformance gate (SPEC 2.0.0).
 *
 * This test renders the real settings panel, reads the real <select> options and
 * feeds them to the shared validator. It is deliberately not a copy of the
 * product logic: if the panel regresses (divider back, free-text target, endpoint
 * only in a placeholder), the payload changes and the validator fails.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderSettingsPanel } from "../../src/ui";
import { LOWEST_REASONING, DEFAULT_SETTINGS } from "../../src/settings";
import {
  CUSTOM_PROVIDER,
  modelsForProvider,
  projectProviders,
  resolveReasoningDepth,
  type ModelsDevData,
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
    models: { "claude-sonnet-4-5": { name: "Claude Sonnet 4.5" } },
  },
  google: {
    api: "https://generativelanguage.googleapis.com/v1beta",
    models: { "gemini-2.5-pro": { name: "Gemini 2.5 Pro" } },
  },
  deepseek: {
    api: "https://api.deepseek.com/v1",
    models: { "deepseek-chat": { name: "DeepSeek Chat" } },
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
  return { locales, keys: Object.keys(files.en || {}), files };
}

function readSelect(root: HTMLElement, name: string): HTMLSelectElement {
  const element = root.querySelector<HTMLSelectElement>(`select[data-dt="${name}"]`);
  if (!element) throw new Error(`settings panel has no select[data-dt="${name}"]`);
  return element;
}

function optionsOf(select: HTMLSelectElement): Array<{ value: string; label: string; disabled: boolean }> {
  return Array.from(select.options).map((option) => ({
    value: option.value,
    label: option.textContent?.trim() || option.value,
    disabled: option.disabled,
  }));
}

function buildPayload(): Record<string, unknown> {
  const host = document.createElement("div");
  const updates: Array<Record<string, unknown>> = [];
  const settings = {
    ...DEFAULT_SETTINGS,
    engine: "ai" as const,
    targetLanguage: "zh-CN",
    aiProvider: "openai",
    aiModel: "gpt-4.1",
    aiReasoningDepth: LOWEST_REASONING,
    aiBaseUrl: "",
  };
  const deps = {
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
  };

  renderSettingsPanel(host, deps);
  const targetSelect = readSelect(host, "target");
  const providerSelect = readSelect(host, "provider");
  const modelSelect = readSelect(host, "model");
  const reasoningSelect = readSelect(host, "reasoning");
  const endpointInput = host.querySelector<HTMLInputElement>('input[data-dt="endpoint"]');

  const providers = projectProviders({ data, builtIns, selectedId: settings.aiProvider, resolveId });
  const sourceById = new Map(providers.map((provider) => [provider.id, provider.source]));
  const providerOptions = optionsOf(providerSelect).map((option) => ({
    ...option,
    source: sourceById.get(option.value) || (option.value === CUSTOM_PROVIDER ? "custom" : "models.dev"),
  }));

  const byProvider: Record<string, Array<{ value: string; label: string }>> = {};
  for (const provider of providers) {
    if (provider.id === CUSTOM_PROVIDER) continue;
    const models = modelsForProvider({ provider: provider.id, data, resolveId });
    if (models.length) byProvider[provider.id] = models.map((model) => ({ value: model.value, label: model.text }));
  }

  // R3: choose a provider and read what the real handler writes.
  const endpoint = endpointInput?.value || "";
  providerSelect.value = "anthropic";
  providerSelect.dispatchEvent(new Event("change"));
  const afterPick = updates.at(-1)?.aiBaseUrl as string | undefined;

  // User override must survive a later provider switch.
  settings.aiBaseUrl = "https://proxy.example/v1";
  providerSelect.value = "deepseek";
  providerSelect.dispatchEvent(new Event("change"));
  const afterSwitch = updates.at(-1)?.aiBaseUrl as string | undefined;

  const reasoningOptions = optionsOf(reasoningSelect).map((option) => ({ value: option.value }));
  const resolveCase = (values: string[]) => ({
    setting: LOWEST_REASONING,
    options: values.map((value) => ({ value })),
    value: resolveReasoningDepth({ setting: LOWEST_REASONING, options: values.map((value) => ({ value })) }),
  });

  const i18n = localeFiles();
  return {
    spec: "2.0.0",
    host: "dualtran-logseq",
    language: {
      control: "select",
      current: settings.targetLanguage,
      options: optionsOf(targetSelect).map(({ value, label }) => ({ value, label })),
    },
    provider: { control: "select", current: "openai", options: providerOptions },
    model: {
      control: "select",
      selectedProvider: "openai",
      selectedModel: "gpt-4.1",
      byProvider,
    },
    endpoint: {
      control: "text",
      autofill: {
        provider: "anthropic",
        providerApi: "https://api.anthropic.com/v1",
        before: endpoint,
        after: afterPick,
        userEdited: "https://proxy.example/v1",
        afterSwitch,
      },
    },
    reasoning: {
      control: "select",
      default: reasoningOptions[0]?.value || "",
      resolved: {
        none: [resolveCase(["none", "minimal", "low"])],
        minimal: [resolveCase(["minimal", "low"])],
        low: [resolveCase(["low", "medium"])],
        "none-declared": [resolveCase([])],
      },
    },
    i18n: {
      locales: i18n.locales,
      keys: i18n.keys,
      files: i18n.files,
      used: [],
    },
    static: {
      hits: scanFiles(repoRoot, {
        files: ["src/ui.ts", "src/catalog.ts", "src/settings.ts"],
        patterns: ["providerSeparator", "__separator__", "__more__", "More (models.dev)"],
      }),
    },
  };
}

describe("host conformance (SPEC 2.0.0)", () => {
  it("kit negative controls still fail", () => {
    expect(selfTest()).toBeGreaterThan(0);
  });

  it("settings panel satisfies the five product rules", () => {
    const summary = validatePayload(buildPayload(), {});
    expect(summary.host).toBe("dualtran-logseq");
    expect(summary.providers).toBeGreaterThanOrEqual(5);
  });
});
