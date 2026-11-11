import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, LOCALE_NAMES, createTranslator, detectLocale, isRtl, normalizeTag, pickLanguageTable } from "../src/i18n";

const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "locales");

/** The 38 languages every DualTran host ships (99-i18n-host-standard). */
const EXPECTED = [
  "af", "ar", "ca", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hr", "hu",
  "is", "it", "ja", "ko", "lv", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru", "sl", "sr", "sv",
  "th", "tr", "ug", "uk", "vi", "zh_CN", "zh_TW",
];

function read(code: string): Record<string, { message: string }> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, code, "messages.json"), "utf8"));
}

describe("locale catalogue", () => {
  const onDisk = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("ships exactly the 38 standard locales", () => {
    expect(onDisk).toEqual([...EXPECTED].sort());
    expect([...LOCALE_CODES].sort()).toEqual([...EXPECTED].sort());
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...EXPECTED].sort());
  });

  it("has the same non-empty keys and placeholders as English", () => {
    const en = read("en");
    const enKeys = Object.keys(en);
    for (const code of EXPECTED) {
      const catalogue = read(code);
      expect(Object.keys(catalogue).sort(), `${code}: key set`).toEqual([...enKeys].sort());
      for (const key of enKeys) {
        const value = catalogue[key]?.message;
        expect(typeof value === "string" && value.trim().length > 0, `${code}: ${key}`).toBe(true);
        const placeholders = en[key].message.match(/\$[A-Z0-9_]+\$/g) || [];
        for (const token of placeholders) {
          expect(value.includes(token), `${code}: ${key} lost ${token}`).toBe(true);
        }
      }
    }
  });

  it("leaves no Chinese text outside zh/ja", () => {
    for (const code of EXPECTED) {
      if (code.startsWith("zh") || code === "ja") continue;
      expect(/[\u4e00-\u9fff]/.test(JSON.stringify(read(code))), `${code}: leftover Chinese`).toBe(false);
    }
  });
});

describe("locale detection", () => {
  it("normalises host tags", () => {
    expect(normalizeTag("zh_CN")).toBe("zh_CN");
    expect(normalizeTag("zh-Hant-TW")).toBe("zh_TW");
    expect(normalizeTag("pt-BR")).toBe("pt_BR");
    expect(normalizeTag("nb-NO")).toBe("no");
  });

  it("prefers exact, then base language, then English", () => {
    expect(detectLocale("de-DE", ["en", "de"])).toBe("de");
    expect(detectLocale("pt-BR", ["en", "pt_BR", "pt_PT"])).toBe("pt_BR");
    expect(detectLocale("xx-YY", ["en", "de"])).toBe("en");
    expect(detectLocale("", ["en", "de"])).toBe("en");
  });

  it("marks RTL languages", () => {
    for (const code of ["ar", "fa", "he", "ug"]) expect(isRtl(code)).toBe(true);
    for (const code of ["en", "de", "ja", "zh_CN"]) expect(isRtl(code)).toBe(false);
  });

  it("picks the language-name table across underscore/hyphen spellings", () => {
    const tables = {
      en: { en: "English" },
      "zh-CN": { en: "英语" },
      "pt-BR": { en: "Inglês" },
    };
    expect(pickLanguageTable(tables, "zh_CN")).toBe(tables["zh-CN"]);
    expect(pickLanguageTable(tables, "pt_BR")).toBe(tables["pt-BR"]);
    expect(pickLanguageTable(tables, "de")).toBe(tables.en);
  });
});

describe("translator", () => {
  it("translates, interpolates and falls back", () => {
    const { t, code } = createTranslator("zh_CN");
    expect(code).toBe("zh_CN");
    expect(t("panelClose")).toBe("关闭");
    expect(t("catalogSummary", { PROVIDERS: 3, MODELS: 9 })).toBe("3 个服务商 · 9 个模型");
    expect(t("missingKey")).toBe("missingKey");
  });
});
