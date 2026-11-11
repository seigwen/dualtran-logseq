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

export interface BridgeDeps {
  core: CoreLike;
  fetchImpl: FetchLike | null;
  getSettings: () => DualTranSettings;
  /** models.dev store; lets the core resolve catalogue-only providers' endpoints. */
  getStore?: () => unknown;
  /** Model-aware effort resolution; defaults to the stored sentinel resolution. */
  resolveReasoningDepth?: (settings: DualTranSettings) => string;
}

export function createBridge({ core, fetchImpl, getSettings, getStore, resolveReasoningDepth }: BridgeDeps) {
  async function translateBlocksAi(blocks: string[], settings: DualTranSettings): Promise<string[]> {
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
        if (!settings.aiModel) throw new Error("No model selected");
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
