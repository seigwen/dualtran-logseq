// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_MODEL, CUSTOM_PROVIDER, PROVIDER_SEPARATOR, type ModelsDevData } from "../src/catalog";
import { LOWEST_REASONING, sanitizeSettings } from "../src/settings";
import { createTranslator } from "../src/i18n";
import { renderSettingsPanel, type PanelDeps } from "../src/ui";

const builtIns = [
  { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", apiBase: "https://api.anthropic.com/v1" },
  { id: "google-gemini", name: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "moonshot", name: "Moonshot", apiBase: "https://api.moonshot.cn/v1" },
];

const data: ModelsDevData = {
  openai: {
    id: "openai",
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
      "gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini" },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    api: "https://api.anthropic.com/v1",
    models: { "claude-sonnet-4": { id: "claude-sonnet-4", name: "Claude Sonnet 4" } },
  },
  moonshotai: { id: "moonshotai", name: "Moonshot AI", api: "https://api.moonshot.ai/v1", models: {} },
  groq: {
    id: "groq",
    name: "Groq",
    api: "https://api.groq.com/openai/v1",
    models: { "llama-3.3-70b": { id: "llama-3.3-70b", name: "Llama 3.3 70B" } },
  },
};

function makeDeps(overrides: Partial<PanelDeps> = {}, settingsOverrides: Record<string, unknown> = {}) {
  let settings = sanitizeSettings({
    engine: "google",
    targetLanguage: "zh-CN",
    aiProvider: "openai",
    aiApiKey: "",
    aiModel: "gpt-4o",
    aiBaseUrl: "",
    aiReasoningDepth: LOWEST_REASONING,
    ...settingsOverrides,
  });
  const updates: Array<Record<string, unknown>> = [];
  const refreshCatalog = vi.fn(async () => undefined);
  const rerender = vi.fn();
  const close = vi.fn();
  const deps: PanelDeps = {
    t: createTranslator("en").t,
    locale: "en",
    version: "0.2.0",
    getSettings: () => settings,
    update: (patch) => {
      updates.push(patch as Record<string, unknown>);
      settings = sanitizeSettings({ ...settings, ...patch });
    },
    catalog: () => data,
    catalogState: () => "ready",
    refreshCatalog,
    languageNames: () => ({ en: "English", "zh-CN": "Chinese (Simplified)", ja: "Japanese" }),
    builtIns,
    resolveId: (id) => (id === "google-gemini" ? "google" : id === "moonshot" ? "moonshotai" : id),
    smartDefault: ({ models }) => (models[0] ? models[0].value : null),
    reasoningOptions: () => [{ value: "low", label: "Low" }],
    close,
    rerender,
    ...overrides,
  };
  return { deps, updates, refreshCatalog, rerender, close, getSettings: () => settings };
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

describe("settings panel", () => {
  it("renders dropdowns for engine, ui language, target language, provider, model and reasoning", () => {
    const host = mount(makeDeps().deps);
    for (const key of ["engine", "uiLang", "target", "provider", "model", "reasoning"]) {
      const el = host.querySelector(`[data-dt="${key}"]`) as HTMLSelectElement | null;
      expect(el, key).not.toBeNull();
      expect(el!.tagName).toBe("SELECT");
    }
    const target = host.querySelector('[data-dt="target"]') as HTMLSelectElement;
    expect(target.tagName).toBe("SELECT");
    expect([...target.options].some((option) => option.textContent === "Chinese (Simplified) (zh-CN)")).toBe(true);
  });

  it("groups providers built-in → divider → catalogue → custom", () => {
    const host = mount(makeDeps().deps);
    const provider = host.querySelector('[data-dt="provider"]') as HTMLSelectElement;
    const options = [...provider.options];
    const ids = options.map((option) => option.value);
    expect(ids.slice(0, 4)).toEqual(["openai", "anthropic", "google-gemini", "moonshot"]);
    const dividerIndex = ids.indexOf(PROVIDER_SEPARATOR);
    expect(dividerIndex).toBe(4);
    expect(options[dividerIndex].disabled).toBe(true);
    expect(ids).toContain("groq");
    expect(ids[ids.length - 1]).toBe(CUSTOM_PROVIDER);
    expect(options[options.length - 1].parentElement?.tagName).toBe("OPTGROUP");
  });

  it("updates model, endpoint and re-renders when the provider changes", () => {
    const { deps, updates, rerender } = makeDeps();
    const host = mount(deps);
    const provider = host.querySelector('[data-dt="provider"]') as HTMLSelectElement;
    provider.value = "anthropic";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(updates[0]).toMatchObject({
      aiProvider: "anthropic",
      aiModel: "claude-sonnet-4",
      aiBaseUrl: "https://api.anthropic.com/v1",
    });
    expect(rerender).toHaveBeenCalled();
  });

  it("keeps a user endpoint override across provider changes", () => {
    const { deps, updates } = makeDeps({}, { aiBaseUrl: "https://proxy.example/v1" });
    const host = mount(deps);
    const provider = host.querySelector('[data-dt="provider"]') as HTMLSelectElement;
    provider.value = "anthropic";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(updates[0]).toMatchObject({ aiBaseUrl: "https://proxy.example/v1" });
  });

  it("shows the custom model input only when the stored model is not listed", () => {
    const listed = mount(makeDeps().deps);
    expect(listed.querySelector('[data-dt="customModel"]')).toBeNull();

    document.body.textContent = "";
    const custom = makeDeps({}, { aiModel: "my-private-model" });
    const host = mount(custom.deps);
    const model = host.querySelector('[data-dt="model"]') as HTMLSelectElement;
    expect(model.value).toBe(CUSTOM_MODEL);
    const input = host.querySelector('[data-dt="customModel"]') as HTMLInputElement;
    expect(input.value).toBe("my-private-model");
    expect(input.tagName).toBe("INPUT");
  });

  it("fills the endpoint input from the provider default and resets it", () => {
    const { deps, updates } = makeDeps({}, { aiBaseUrl: "" });
    const host = mount(deps);
    const endpoint = host.querySelector('[data-dt="endpoint"]') as HTMLInputElement;
    expect(endpoint.value).toBe("https://api.openai.com/v1");
    (host.querySelector('[data-dt="resetEndpoint"]') as HTMLButtonElement).click();
    expect(updates[updates.length - 1]).toEqual({ aiBaseUrl: "" });
  });

  it("shows catalogue status and refreshes", async () => {
    const { deps, refreshCatalog } = makeDeps();
    const host = mount(deps);
    expect((host.querySelector('[data-dt="catalogStatus"]') as HTMLElement).textContent).toContain("providers");
    (host.querySelector('[data-dt="refresh"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
  });

  it("renders the loading status and disables refresh while fetching", () => {
    const { deps } = makeDeps({ catalogState: () => "loading" }, {});
    const host = mount(deps);
    expect((host.querySelector('[data-dt="catalogStatus"]') as HTMLElement).textContent).toContain("Loading");
    expect((host.querySelector('[data-dt="refresh"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies RTL and localized labels", () => {
    const { deps } = makeDeps({ locale: "ar", t: createTranslator("ar").t });
    const host = mount(deps);
    expect((host.querySelector(".dt-panel") as HTMLElement).getAttribute("dir")).toBe("rtl");
    expect(host.textContent).toContain(createTranslator("ar").t("panelTitle"));
  });

  it("closes on backdrop click but not on panel click", () => {
    const { deps, close } = makeDeps();
    const host = mount(deps);
    (host.querySelector(".dt-panel") as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    (host.querySelector('[data-dt="backdrop"]') as HTMLElement).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
