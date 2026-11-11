import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROVIDER,
  effectiveBaseUrl,
  languageOptions,
  modelReasoningOptions,
  modelsForProvider,
  pickModelForProvider,
  projectProviders,
  reasoningDepthChoices,
  resolveEndpointOnProviderChange,
  resolveReasoningDepth,
  summarizeCatalog,
  withCurrentModel,
  type ModelsDevData,
} from "../src/catalog";
import { LOWEST_REASONING } from "../src/settings";

const builtIns = [
  { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", apiBase: "https://api.anthropic.com/v1" },
  { id: "google-gemini", name: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "moonshot", name: "Moonshot", apiBase: "https://api.moonshot.cn/v1" },
];

const ALIASES: Record<string, string> = {
  "google-gemini": "google",
  moonshot: "moonshotai",
  grok: "xai",
  zhipu: "zhipuai",
  qwen: "alibaba-cn",
  together: "togetherai",
  "azure-openai": "azure",
};

const resolveId = (id: string): string => ALIASES[id] || id;

const data: ModelsDevData = {
  openai: {
    id: "openai",
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
    models: {
      "gpt-4o": { id: "gpt-4o", name: "GPT-4o", reasoning_options: [{ type: "effort", values: ["low", "medium"] }] },
      "gpt-4o-mini": { id: "gpt-4o-mini" },
    },
  },
  anthropic: { id: "anthropic", name: "Anthropic", api: "https://api.anthropic.com/v1" },
  google: { id: "google", name: "Google", api: "https://generativelanguage.googleapis.com/v1beta" },
  moonshotai: {
    id: "moonshotai",
    name: "Moonshot AI",
    api: "https://api.moonshot.ai/v1",
    models: { "kimi-k2": { id: "kimi-k2", name: "Kimi K2" } },
  },
  templated: { id: "templated", name: "Templated", api: "https://${HOST}/v1" },
  noapi: { id: "noapi", name: "No API" },
};

describe("projectProviders", () => {
  it("mixes built-ins and catalogue entries into one alphabetical list", () => {
    const options = projectProviders({ data, builtIns, selectedId: "openai", resolveId });
    const providers = options.slice(0, -1);
    expect(providers.map((option) => option.id)).toEqual([
      "anthropic",
      "google-gemini",
      "moonshot",
      "openai",
    ]);
    expect(options[options.length - 1].id).toBe(CUSTOM_PROVIDER);
    expect(options.map((option) => option.id)).not.toContain("templated");
  });

  it("dedupes catalogue twins of built-ins and skips uncallable api values", () => {
    const ids = projectProviders({ data, builtIns, selectedId: "openai", resolveId }).map((option) => option.id);
    expect(ids).not.toContain("google");
    expect(ids).not.toContain("moonshotai");
    expect(ids).not.toContain("templated");
    expect(ids).not.toContain("noapi");
  });

  it("keeps an unknown saved id selectable in its alphabetical place", () => {
    const options = projectProviders({ data, builtIns, selectedId: "legacy-provider", resolveId });
    const ids = options.map((option) => option.id);
    expect(ids).toContain("legacy-provider");
    const labels = options.slice(0, -1).map((option) => option.label);
    expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right)));
  });

  it("marks the custom sentinel at the end", () => {
    const options = projectProviders({ data, builtIns, selectedId: "openai", resolveId });
    expect(options.find((option) => option.id === CUSTOM_PROVIDER)?.label).toBe("Custom…");
    expect(options[options.length - 1].id).toBe(CUSTOM_PROVIDER);
  });
});

describe("modelsForProvider", () => {
  it("resolves aliases and sorts by name", () => {
    const models = modelsForProvider({ provider: "google-gemini", data, resolveId });
    expect(models).toEqual([]);
    const moon = modelsForProvider({ provider: "moonshot", data, resolveId });
    expect(moon).toEqual([{ value: "kimi-k2", text: "Kimi K2" }]);
  });

  it("falls back to the id when the catalogue has no name", () => {
    expect(modelsForProvider({ provider: "openai", data, resolveId })).toEqual([
      { value: "gpt-4o", text: "GPT-4o" },
      { value: "gpt-4o-mini", text: "gpt-4o-mini" },
    ]);
  });

  it("returns [] for an unknown provider or no data", () => {
    expect(modelsForProvider({ provider: "nope", data, resolveId })).toEqual([]);
    expect(modelsForProvider({ provider: "openai", data: null, resolveId })).toEqual([]);
  });

  it("keeps the stored model visible when the catalogue dropped it", () => {
    const models = withCurrentModel(modelsForProvider({ provider: "openai", data, resolveId }), "gpt-3.5-turbo");
    expect(models.map((model) => model.value)).toContain("gpt-3.5-turbo");
  });
});

describe("pickModelForProvider", () => {
  const models = [
    { value: "a", text: "A" },
    { value: "b", text: "B" },
  ];
  it("keeps a model the new provider lists", () => {
    expect(pickModelForProvider({ models, current: "b", provider: "p", smartDefault: () => "a" })).toBe("b");
  });
  it("uses the smart default when the current model is gone", () => {
    expect(pickModelForProvider({ models, current: "z", provider: "p", smartDefault: () => "b" })).toBe("b");
  });
  it("falls back to the first model, then to empty", () => {
    expect(pickModelForProvider({ models, current: "z", provider: "p", smartDefault: () => null })).toBe("a");
    expect(pickModelForProvider({ models: [], current: "z", provider: "p", smartDefault: () => null })).toBe("");
  });
});

describe("languageOptions", () => {
  it("labels names with codes, sorts, drops auto, keeps the current value", () => {
    const options = languageOptions({
      names: { en: "English", "zh-CN": "Chinese (Simplified)", auto: "Auto", ja: "Japanese" },
      current: "xx-YY",
    });
    expect(options.map((option) => option.value)).toEqual(["zh-CN", "en", "ja", "xx-YY"]);
    expect(options[0].text).toBe("Chinese (Simplified) (zh-CN)");
  });
});

describe("effectiveBaseUrl", () => {
  it("prefers the catalogue api, stripped of path and slash", () => {
    expect(
      effectiveBaseUrl({ provider: "openai", data, builtIns, resolveId }),
    ).toBe("https://api.openai.com/v1");
    // models.dev lists Anthropic's request URL, not its base URL.
    expect(
      effectiveBaseUrl({ provider: "anthropic", data: { anthropic: { api: "https://api.anthropic.com/v1/messages" } }, builtIns, resolveId }),
    ).toBe("https://api.anthropic.com/v1");
  });
  it("falls back to the built-in apiBase and normalises it", () => {
    expect(effectiveBaseUrl({ provider: "anthropic", data: null, builtIns, resolveId })).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(effectiveBaseUrl({ provider: "google-gemini", data, builtIns, resolveId })).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });
  it("never returns a templated catalogue api", () => {
    expect(effectiveBaseUrl({ provider: "templated", data, builtIns, resolveId })).toBe("");
  });
});

describe("resolveEndpointOnProviderChange", () => {
  const base = { data, builtIns, resolveId };
  it("fills the new default when the field was empty", () => {
    expect(
      resolveEndpointOnProviderChange({ ...base, current: "", previousProvider: "openai", nextProvider: "anthropic" }),
    ).toBe("https://api.anthropic.com/v1");
  });
  it("replaces the previous default with the new one", () => {
    expect(
      resolveEndpointOnProviderChange({
        ...base,
        current: "https://api.openai.com/v1/",
        previousProvider: "openai",
        nextProvider: "moonshot",
      }),
    ).toBe("https://api.moonshot.ai/v1");
  });
  it("keeps a user override", () => {
    expect(
      resolveEndpointOnProviderChange({
        ...base,
        current: "https://proxy.example.com/v1",
        previousProvider: "openai",
        nextProvider: "anthropic",
      }),
    ).toBe("https://proxy.example.com/v1");
  });
  it("keeps the value when the new provider has no known default", () => {
    expect(
      resolveEndpointOnProviderChange({
        ...base,
        current: "https://proxy.example",
        previousProvider: "openai",
        nextProvider: "unknown-provider",
      }),
    ).toBe("https://proxy.example");
  });
});

describe("reasoning", () => {
  it("reads the model's declared options", () => {
    expect(
      modelReasoningOptions({ data, resolveId, provider: "openai", model: "gpt-4o" }),
    ).toEqual([{ type: "effort", values: ["low", "medium"] }]);
    expect(modelReasoningOptions({ data, resolveId, provider: "openai", model: "gpt-4o-mini" })).toEqual([]);
  });

  it("resolves the lowest sentinel through none → minimal → low", () => {
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: [{ value: "high" }, { value: "low" }] })).toBe("low");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: [{ value: "none" }, { value: "low" }] })).toBe("none");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: [{ value: "high" }] })).toBe("");
    expect(resolveReasoningDepth({ setting: "", options: [{ value: "low" }] })).toBe("");
    expect(resolveReasoningDepth({ setting: "high", options: [] })).toBe("high");
  });

  it("builds choices with the sentinel and provider default first", () => {
    const choices = reasoningDepthChoices({ options: [{ value: "low", label: "Low" }] });
    expect(choices.map((choice) => choice.value)).toEqual([LOWEST_REASONING, "", "low"]);
  });
});

describe("summarizeCatalog", () => {
  it("reports offline for null and counts providers/models", () => {
    expect(summarizeCatalog(null)).toEqual({ providerCount: 0, modelCount: 0, offline: true });
    const summary = summarizeCatalog(data);
    expect(summary.offline).toBe(false);
    expect(summary.providerCount).toBe(6);
    expect(summary.modelCount).toBe(3);
  });
});
