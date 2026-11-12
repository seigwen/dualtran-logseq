/**
 * Host-agnostic translation bridge over @dualtran/core.
 *
 * Everything is dependency-injected ({ core, fetchImpl, getSettings }) so the
 * unit suite runs against stub cores with zero module mocking and zero network.
 * The only real import of the vendored core lives in src/coreAdapter.ts.
 */
import { LOWEST_REASONING, type DualTranSettings } from "./settings";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export interface CoreLike {
  translateGoogle(args: {
    sourceArray: string[];
    sourceLanguage: string;
    targetLanguage: string;
    cache: unknown;
    fetchImpl: FetchLike | null;
  }): Promise<string[]>;
  streamChat(args: {
    provider: string;
    apiKey?: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    extra?: Record<string, unknown>;
    store?: unknown;
    fetch?: unknown;
    reasoningDepth?: string;
    onChunk?: (text: string) => void;
  }): Promise<{ totalChunks: number; streamError: unknown }>;
  buildTranslationMessages(args: { content: string; targetLanguageName: string }): {
    system: string;
    assistant?: string;
  };
  codeToLanguageNameInEnglish?(code: string): string;
  formatAiError(error: unknown): { message: string };
}

/** Trim every block, drop the ones that became empty, keep the order. */
export function normalizeBlocks(blocks: string[]): string[] {
  return blocks.map((block) => block.trim()).filter((block) => block.length > 0);
}

/** English source text of `providerRequiredError` (used when no translator is wired). */
export const PROVIDER_REQUIRED_FALLBACK = "Choose an AI provider in settings before translating.";

/**
 * Guard for every AI path (SPEC 2.1 rule 5). Returns the localized message when
 * AI mode has no provider, otherwise "". The caller must stop — there is no
 * fallback provider behind this.
 */
export function providerRequiredErrorFor(
  settings: { engine: string; aiProvider: string },
  message?: string,
): string {
  if (settings.engine !== "ai") return "";
  if (String(settings.aiProvider || "").trim()) return "";
  return message && message.trim() ? message : PROVIDER_REQUIRED_FALLBACK;
}

export interface BridgeDeps {
  core: CoreLike;
  fetchImpl: FetchLike | null;
  getSettings: () => DualTranSettings;
  /** models.dev store; lets the core resolve catalogue-only providers' endpoints. */
  getStore?: () => unknown;
  /** Model-aware effort resolution; defaults to the stored sentinel resolution. */
  resolveReasoningDepth?: (settings: DualTranSettings) => string;
  /** Localized `providerRequiredError`; English source text when omitted. */
  providerRequiredError?: (settings: DualTranSettings) => string;
}

export function createBridge({
  core,
  fetchImpl,
  getSettings,
  getStore,
  resolveReasoningDepth,
  providerRequiredError,
}: BridgeDeps) {
  async function translateBlocksAi(blocks: string[], settings: DualTranSettings): Promise<string[]> {
    // SPEC 2.1: an unconfigured provider stops the whole batch before the first
    // request — no prompt is built and nothing is sent.
    const missing = providerRequiredErrorFor(settings, providerRequiredError ? providerRequiredError(settings) : "");
    if (missing) throw new Error(missing);
    if (!settings.aiModel) throw new Error("No model selected");
    const results: string[] = [];
    for (const content of blocks) {
      const targetLanguageName =
        core.codeToLanguageNameInEnglish?.(settings.targetLanguage) || settings.targetLanguage;
      const prompt = core.buildTranslationMessages({ content, targetLanguageName });
      // Same shape as the extension's fetchSSE assembly (system prompt +
      // acknowledgment + content), so translation quality matches the product.
      const messages = [
        { role: "system", content: prompt.system },
        { role: "user", content: "I understand. Please give me the text." },
        { role: "user", content },
      ];
      let text = "";
      const depth = resolveReasoningDepth
        ? resolveReasoningDepth(settings)
        : settings.aiReasoningDepth === LOWEST_REASONING
          ? ""
          : settings.aiReasoningDepth || "";
      const { totalChunks, streamError } = await core.streamChat({
        provider: settings.aiProvider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        messages,
        extra: settings.aiBaseUrl ? { baseURL: settings.aiBaseUrl } : {},
        store: getStore ? getStore() ?? null : null,
        fetch: fetchImpl,
        reasoningDepth: depth,
        onChunk: (chunk: string) => {
          text += chunk;
        },
      });
      if (streamError) throw new Error(core.formatAiError(streamError).message);
      if (totalChunks === 0) throw new Error("No response from AI provider");
      results.push(text);
    }
    return results;
  }

  return {
    /**
     * Translate a batch of text pieces. Google goes out as ONE batched request
     * (the core builds it); AI streams one request per piece. Empty input
     * short-circuits without touching the engine.
     */
    async translateBlocks(blocks: string[]): Promise<string[]> {
      const normalized = normalizeBlocks(blocks);
      if (normalized.length === 0) return [];
      const settings = getSettings();
      if (settings.engine === "ai") {
        // translateBlocksAi owns the provider guard (SPEC 2.1 rule 5), so every
        // caller — commands, page translation, tests — passes through one check.
        return translateBlocksAi(normalized, settings);
      }
      return core.translateGoogle({
        sourceArray: normalized,
        sourceLanguage: "auto",
        targetLanguage: settings.targetLanguage,
        cache: null,
        fetchImpl,
      });
    },
  };
}
