// @vitest-environment jsdom
/**
 * SPEC 2.1 — the unconfigured state.
 *
 * A fresh install has no AI provider. Nothing may quietly become `openai`: the
 * panel must show a disabled, selected placeholder, the model picker must stay
 * empty, and a translate command has to stop with a localized message before a
 * single byte leaves the plugin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_PROVIDER, type ModelsDevData } from "../src/catalog";
import { createTranslator } from "../src/i18n";
import { DEFAULT_SETTINGS, LOWEST_REASONING, readSettings, sanitizeSettings } from "../src/settings";
import { createBridge, type CoreLike, type FetchLike } from "../src/bridge";
import { renderSettingsPanel, type PanelDeps } from "../src/ui";

const builtIns = [
  { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", apiBase: "https://api.anthropic.com/v1" },
  { id: "google-gemini", name: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "moonshot", name: "Moonshot", apiBase: "https://api.moonshot.cn/v1" },
  { id: "deepseek", name: "DeepSeek", apiBase: "https://api.deepseek.com/v1" },
];

const data: ModelsDevData = {
  openai: { api: "https://api.openai.com/v1", models: { "gpt-4o": { name: "GPT-4o" } } },
  anthropic: { api: "https://api.anthropic.com/v1", models: { "claude-sonnet-4": { name: "Claude Sonnet 4" } } },
  google: { api: "https://generativelanguage.googleapis.com/v1beta", models: { "gemini-2.5-pro": { name: "Gemini 2.5 Pro" } } },
  deepseek: { api: "https://api.deepseek.com/v1", models: { "deepseek-chat": { name: "DeepSeek Chat" } } },
};

function makeDeps(settingsOverrides: Record<string, unknown> = {}, overrides: Partial<PanelDeps> = {}) {
  let settings = sanitizeSettings({
    engine: "ai",
    targetLanguage: "zh-CN",
    aiProvider: "",
    aiApiKey: "",
    aiModel: "",
    aiBaseUrl: "",
    aiReasoningDepth: LOWEST_REASONING,
    ...settingsOverrides,
  });
  const updates: Array<Record<string, unknown>> = [];
  const deps: PanelDeps = {
    t: createTranslator("en").t,
    locale: "en",
    version: "0.3.0",
    getSettings: () => settings,
    update: (patch) => {
      updates.push(patch as Record<string, unknown>);
      settings = sanitizeSettings({ ...settings, ...patch });
    },
    catalog: () => data,
    catalogState: () => "ready",
    refreshCatalog: async () => undefined,
    languageNames: () => ({ en: "English", "zh-CN": "Chinese (Simplified)" }),
    builtIns,
    resolveId: (id) => (id === "google-gemini" ? "google" : id),
    smartDefault: ({ models }) => (models[0] ? models[0].value : null),
    reasoningOptions: () => [{ value: "low", label: "Low" }],
    close: () => undefined,
    rerender: () => undefined,
    ...overrides,
  };
  return { deps, updates, settings: () => settings };
}

function mount(deps: PanelDeps): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderSettingsPanel(host, deps);
  return host;
}

beforeEach(() => {
  document.body.textContent = "";
});

describe("fresh install defaults", () => {
  it("defaults the AI provider to an empty string", () => {
    expect(DEFAULT_SETTINGS.aiProvider).toBe("");
    expect(sanitizeSettings({}).aiProvider).toBe("");
  });

  it("migrates legacy 0.1.x config with the Q14 C mapping", () => {
    const context = { preferredLanguage: "en", supportedLanguages: ["en"] };

    // Recognized key → that provider.
    const keyed = readSettings({ apiKey: "sk-legacy", endpoint: "https://api.anthropic.com/v1", model: "claude-x" }, context);
    expect(keyed.settings.aiProvider).toBe("anthropic");
    expect(keyed.patch.aiProvider).toBe("anthropic");

    // No recognized key, but an endpoint or model → custom endpoint provider.
    const custom = readSettings({ endpoint: "https://proxy.example/v1", model: "my-model" }, context);
    expect(custom.settings.aiProvider).toBe(CUSTOM_PROVIDER);
    expect(custom.patch.aiProvider).toBe(CUSTOM_PROVIDER);
    const modelOnly = readSettings({ model: "gpt-4o-mini" }, context);
    expect(modelOnly.settings.aiProvider).toBe("openai");

    // Nothing at all → still unconfigured.
    const empty = readSettings({ target: "de" }, context);
    expect(empty.settings.aiProvider).toBe("");
    expect(empty.patch.aiProvider).toBe("");
  });

  it("never rewrites a stored provider", () => {
    const context = { preferredLanguage: "en", supportedLanguages: ["en"] };
    const kept = readSettings({ aiProvider: "moonshot", aiModel: "kimi-k2", aiApiKey: "k" }, context);
    expect(kept.settings.aiProvider).toBe("moonshot");
    expect(kept.patch).toEqual({});
  });
});

describe("settings panel — unconfigured", () => {
  it("shows one disabled, selected placeholder that is not a real option", () => {
    const host = mount(makeDeps().deps);
    const provider = host.querySelector('[data-dt="provider"]') as HTMLSelectElement;
    const placeholder = [...provider.options].find((option) => option.value === "");
    expect(placeholder).toBeDefined();
    expect(placeholder!.textContent).toBe("Select a provider");
    expect(placeholder!.disabled).toBe(true);
    expect(placeholder!.selected).toBe(true);
    expect(provider.value).toBe("");

    const real = [...provider.options].filter((option) => option.value !== "");
    expect(real.map((option) => option.textContent)).toEqual([
      "Anthropic",
      "DeepSeek",
      "Google Gemini",
      "Moonshot",
      "OpenAI",
      "Custom provider…",
    ]);
    expect(real[real.length - 1].value).toBe(CUSTOM_PROVIDER);
    expect(real.filter((option) => option.value === CUSTOM_PROVIDER)).toHaveLength(1);
    // Exactly one empty-valued entry, and the placeholder is not sorted in.
    expect([...provider.options].filter((option) => option.value === "")).toHaveLength(1);
    expect(provider.options[0].value).toBe("");
  });

  it("leaves endpoint empty with the bare https:// placeholder and no OpenAI hint", () => {
    const host = mount(makeDeps().deps);
    const endpoint = host.querySelector('[data-dt="endpoint"]') as HTMLInputElement;
    expect(endpoint.value).toBe("");
    expect(endpoint.placeholder).toBe("https://");
    expect(host.innerHTML).not.toContain("api.openai.com");
    expect(host.innerHTML).not.toMatch(/gpt-4o/i);
  });

  it("keeps the model picker empty and disabled with its own placeholder", () => {
    const host = mount(makeDeps().deps);
    const model = host.querySelector('[data-dt="model"]') as HTMLSelectElement;
    expect(model.disabled).toBe(true);
    expect(model.value).toBe("");
    expect([...model.options]).toHaveLength(1);
    expect(model.options[0].textContent).toBe("Select a provider first");
    expect(model.options[0].disabled).toBe(true);
    expect((host.querySelector('[data-dt="customModel"]') as HTMLElement | null)).toBeNull();
  });

  it("keeps the reasoning picker disabled when the host declares no levels at all", () => {
    const { deps, updates, settings } = makeDeps();
    const host = mount(deps);
    const reasoning = host.querySelector('[data-dt="reasoning"]') as HTMLSelectElement;
    expect(reasoning.disabled).toBe(true);
    expect(reasoning.value).toBe(LOWEST_REASONING);
    expect(settings().aiReasoningDepth).toBe(LOWEST_REASONING);
    // Opening the panel must not rewrite the sentinel or the provider.
    expect(updates.filter((patch) => "aiReasoningDepth" in patch || "aiProvider" in patch)).toEqual([]);
  });

  it("disables the primary translate button with the providerRequiredError tooltip", () => {
    const runTranslate = vi.fn();
    const { deps } = makeDeps({}, { runTranslate });
    const host = mount(deps);
    const button = host.querySelector('[data-dt="translate"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Choose an AI provider in settings before translating.");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    button.click();
    expect(runTranslate).not.toHaveBeenCalled();

    // Configured: the same button is live and unlabelled by the guard.
    document.body.textContent = "";
    const live = makeDeps({ aiProvider: "anthropic", aiModel: "claude-sonnet-4" }, { runTranslate });
    const configured = mount(live.deps);
    const enabled = configured.querySelector('[data-dt="translate"]') as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    expect(enabled.title).toBe("");
    enabled.click();
    expect(runTranslate).toHaveBeenCalledTimes(1);
  });

  it("fills endpoint, model and reasoning once a provider is chosen", () => {
    const { deps, updates } = makeDeps();
    const host = mount(deps);
    const provider = host.querySelector('[data-dt="provider"]') as HTMLSelectElement;
    provider.value = "anthropic";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(updates[0]).toMatchObject({
      aiProvider: "anthropic",
      aiModel: "claude-sonnet-4",
      aiBaseUrl: "https://api.anthropic.com/v1",
    });

    // Second render, from the just-written settings.
    document.body.textContent = "";
    const after = makeDeps({ aiProvider: "anthropic", aiModel: "claude-sonnet-4" });
    const rendered = mount(after.deps);
    const endpoint = rendered.querySelector('[data-dt="endpoint"]') as HTMLInputElement;
    expect(endpoint.value).toBe("https://api.anthropic.com/v1");
    const model = rendered.querySelector('[data-dt="model"]') as HTMLSelectElement;
    expect(model.disabled).toBe(false);
    expect([...model.options].map((option) => option.value)).toContain("claude-sonnet-4");
    const reasoning = rendered.querySelector('[data-dt="reasoning"]') as HTMLSelectElement;
    expect(reasoning.disabled).toBe(false);
  });
});

function stubCore(overrides: Partial<CoreLike> = {}): CoreLike {
  return {
    translateGoogle: vi.fn(async ({ sourceArray }: { sourceArray: string[] }) => sourceArray.map((text) => `G:${text}`)),
    streamChat: vi.fn(async () => ({ totalChunks: 1, streamError: null })),
    buildTranslationMessages: vi.fn(() => ({ system: "SYS" })),
    formatAiError: (error: unknown) => ({ message: String(error) }),
    ...overrides,
  } as CoreLike;
}

describe("bridge — unconfigured provider never reaches the network", () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error("network must not be touched");
  }) as unknown as FetchLike;

  beforeEach(() => {
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("rejects with the localized providerRequiredError and sends nothing", async () => {
    const core = stubCore();
    const bridge = createBridge({
      core,
      fetchImpl,
      getSettings: () => sanitizeSettings({ engine: "ai", aiProvider: "", aiModel: "", aiApiKey: "" }),
      providerRequiredError: () => "Choose an AI provider in settings before translating.",
    });
    await expect(bridge.translateBlocks(["Hello"])).rejects.toThrow(
      "Choose an AI provider in settings before translating.",
    );
    expect(core.streamChat).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("has no OpenAI fallback on the request path", async () => {
    const core = stubCore();
    const bridge = createBridge({
      core,
      fetchImpl,
      getSettings: () => sanitizeSettings({ engine: "ai", aiProvider: "", aiModel: "gpt-4o", aiApiKey: "sk" }),
    });
    await expect(bridge.translateBlocks(["Hello"])).rejects.toThrow(/provider/i);
    expect(core.streamChat).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
