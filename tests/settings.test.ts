import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LEGACY_DEFAULT_ENDPOINT,
  LOWEST_REASONING,
  mapHostLanguage,
  readSettings,
  sanitizeSettings,
} from "../src/settings";

describe("mapHostLanguage", () => {
  const supported = ["en", "zh-CN", "zh-TW", "pt-PT", "pt-BR", "de", "no"];
  it("maps host tags onto catalogue codes", () => {
    expect(mapHostLanguage("zh_CN", supported)).toBe("zh-CN");
    expect(mapHostLanguage("zh-TW", supported)).toBe("zh-TW");
    expect(mapHostLanguage("zh-Hant-HK", supported)).toBe("zh-TW");
    expect(mapHostLanguage("pt_BR", supported)).toBe("pt-BR");
    expect(mapHostLanguage("de-DE", supported)).toBe("de");
    expect(mapHostLanguage("nb", supported)).toBe("no");
  });
  it("falls back to English", () => {
    expect(mapHostLanguage("xx-YY", supported)).toBe("en");
    expect(mapHostLanguage("", supported)).toBe("en");
    expect(mapHostLanguage(undefined, supported)).toBe("en");
  });
});

describe("sanitizeSettings", () => {
  it("keeps strings, drops junk and unknown engines", () => {
    const settings = sanitizeSettings({
      engine: "nope",
      targetLanguage: 7,
      aiProvider: "anthropic",
      aiBaseUrl: "https://x",
      extra: "ignored",
      uiLang: "de",
    });
    expect(settings.engine).toBe("google");
    expect(settings.targetLanguage).toBe(DEFAULT_SETTINGS.targetLanguage);
    expect(settings.aiProvider).toBe("anthropic");
    expect(settings.aiBaseUrl).toBe("https://x");
    expect(settings.uiLang).toBe("de");
    expect((settings as unknown as Record<string, unknown>).extra).toBeUndefined();
  });
});

describe("readSettings", () => {
  const context = { preferredLanguage: "de-DE", supportedLanguages: ["en", "de", "zh-CN"] };

  it("migrates a 0.1.x install, treating the old default endpoint as auto", () => {
    const result = readSettings(
      {
        engine: "ai",
        target: "zh-CN",
        endpoint: LEGACY_DEFAULT_ENDPOINT,
        apiKey: "sk-old",
        model: "gpt-4o-mini",
      },
      context,
    );
    expect(result.migrated).toBe(true);
    // SPEC 2.1 / Q14 C: the old OpenAI endpoint together with an OpenAI model
    // id migrates to openai; the old endpoint itself becomes "auto" ("").
    expect(result.settings).toEqual({
      engine: "ai",
      targetLanguage: "zh-CN",
      aiProvider: "openai",
      aiApiKey: "sk-old",
      aiModel: "gpt-4o-mini",
      aiBaseUrl: "",
      aiReasoningDepth: LOWEST_REASONING,
      uiLang: "",
    });
    expect(result.patch).toMatchObject({ targetLanguage: "zh-CN", aiBaseUrl: "" });
  });

  it("keeps a custom legacy endpoint as the override", () => {
    const result = readSettings({ endpoint: "https://proxy.example/v1" }, context);
    expect(result.settings.aiBaseUrl).toBe("https://proxy.example/v1");
  });

  it("defaults the target to the host language for a fresh install", () => {
    const result = readSettings({}, context);
    expect(result.settings.targetLanguage).toBe("de");
  });

  it("does not overwrite an existing new-shape install", () => {
    const existing = {
      targetLanguage: "ja",
      aiProvider: "moonshot",
      aiModel: "kimi-k2",
      aiBaseUrl: "https://proxy.example",
      aiApiKey: "k",
      aiReasoningDepth: "low",
      uiLang: "en",
      engine: "ai",
    };
    const result = readSettings(existing, context);
    expect(result.migrated).toBe(false);
    expect(result.patch).toEqual({});
    expect(result.settings.targetLanguage).toBe("ja");
    expect(result.settings.aiReasoningDepth).toBe("low");
  });
});
