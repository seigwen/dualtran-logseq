/**
 * Settings shape, defaults, legacy migration and host-language mapping.
 *
 * Pure module: no Logseq import, so the unit suite runs in plain node. The
 * host passes `logseq.settings` plus Logseq's preferred language and writes
 * the returned `patch` back with `logseq.updateSettings` on first run.
 */
export type Engine = "google" | "ai";

/**
 * Persisted value meaning "use the lowest reasoning level the current model
 * accepts". Resolved per request (model-dependent), never sent to a provider.
 */
export const LOWEST_REASONING = "__lowest__";

export interface DualTranSettings {
  engine: Engine;
  targetLanguage: string;
  aiProvider: string;
  aiApiKey: string;
  aiModel: string;
  /** Explicit override; empty means "use the provider default from the catalogue". */
  aiBaseUrl: string;
  aiReasoningDepth: string;
  /** Interface language override; empty follows Logseq's own language. */
  uiLang: string;
}

export const DEFAULT_SETTINGS: DualTranSettings = {
  engine: "google",
  targetLanguage: "en",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "",
  aiBaseUrl: "",
  aiReasoningDepth: LOWEST_REASONING,
  uiLang: "",
};

/** Keys written by 0.1.x; kept in settings.json (Logseq cannot delete keys). */
export const LEGACY_KEYS = ["target", "endpoint", "apiKey", "model"] as const;

/** 0.1.x default endpoint — a stored copy of it means "auto", not an override. */
export const LEGACY_DEFAULT_ENDPOINT = "https://api.openai.com/v1";

/**
 * Map a host locale (`zh_CN`, `pt-BR`, `de-DE`, …) onto a translation language
 * code from core's table (`zh-CN`, `pt-BR`, `de`, …). Unknown → `en`.
 */
export function mapHostLanguage(preferred: string | undefined | null, supported: string[]): string {
  const raw = String(preferred || "").trim().replace(/_/g, "-").toLowerCase();
  if (!raw) return "en";
  const byLower = new Map(supported.map((code) => [code.toLowerCase(), code]));
  const exact = byLower.get(raw);
  if (exact) return exact;
  if (raw.startsWith("zh-hant") || raw === "zh-tw" || raw === "zh-hk" || raw === "zh-mo") {
    return byLower.get("zh-tw") || "en";
  }
  if (raw.startsWith("zh")) return byLower.get("zh-cn") || "en";
  if (raw === "pt" || raw === "pt-pt") return byLower.get("pt-pt") || "en";
  if (raw === "pt-br") return byLower.get("pt-br") || "en";
  if (raw === "nb" || raw === "nb-no" || raw === "nn" || raw === "no-no") return byLower.get("no") || "en";
  const base = raw.split("-")[0];
  return byLower.get(base) || "en";
}

/**
 * Coerce persisted data into a valid settings object: unknown fields dropped,
 * non-strings fall back to defaults, an unknown engine falls back to google.
 */
export function sanitizeSettings(raw: unknown): DualTranSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const settings: DualTranSettings = { ...DEFAULT_SETTINGS };
  if (source.engine === "google" || source.engine === "ai") settings.engine = source.engine;
  const stringKeys = [
    "targetLanguage",
    "aiProvider",
    "aiApiKey",
    "aiModel",
    "aiBaseUrl",
    "aiReasoningDepth",
    "uiLang",
  ] as const;
  for (const key of stringKeys) {
    if (typeof source[key] === "string") settings[key] = source[key];
  }
  return settings;
}

export interface MigrationResult {
  settings: DualTranSettings;
  /** Keys to write back on first run (empty when nothing was migrated). */
  patch: Record<string, string>;
  migrated: boolean;
}

/**
 * Read settings, migrating a 0.1.x install on the fly.
 *
 * New keys win when present; a legacy `endpoint` equal to the 0.1.x default is
 * treated as "auto" so the new panel keeps following the provider.
 */
export function readSettings(
  raw: unknown,
  context: { preferredLanguage?: string | null; supportedLanguages: string[] },
): MigrationResult {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hasNewShape = ["targetLanguage", "aiProvider", "aiModel", "aiBaseUrl", "aiApiKey", "aiReasoningDepth", "uiLang"]
    .some((key) => typeof source[key] === "string");
  const fallbackTarget = mapHostLanguage(context.preferredLanguage, context.supportedLanguages);

  if (hasNewShape) {
    const settings = sanitizeSettings(source);
    if (!settings.targetLanguage) settings.targetLanguage = fallbackTarget;
    return { settings, patch: {}, migrated: false };
  }

  const legacy = (key: string): string => (typeof source[key] === "string" ? (source[key] as string).trim() : "");
  const patch: Record<string, string> = {};
  patch.engine = source.engine === "ai" ? "ai" : "google";
  patch.targetLanguage = legacy("target") || fallbackTarget;
  patch.aiProvider = "openai";
  patch.aiApiKey = legacy("apiKey");
  patch.aiModel = legacy("model");
  const endpoint = legacy("endpoint");
  patch.aiBaseUrl = !endpoint || endpoint.replace(/\/+$/, "") === LEGACY_DEFAULT_ENDPOINT ? "" : endpoint;
  patch.aiReasoningDepth = LOWEST_REASONING;
  patch.uiLang = "";
  return { settings: sanitizeSettings(patch), patch, migrated: true };
}
