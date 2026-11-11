import { describe, expect, it, vi } from "vitest";
import { createBridge, normalizeBlocks, type CoreLike, type FetchLike } from "../src/bridge";
import { LOWEST_REASONING, sanitizeSettings } from "../src/settings";

function stubCore(overrides: Partial<CoreLike> = {}): CoreLike {
  return {
    translateGoogle: vi.fn(async ({ sourceArray }: { sourceArray: string[] }) =>
      sourceArray.map((text) => `G:${text}`),
    ),
    streamChat: vi.fn(async () => ({ totalChunks: 1, streamError: null })),
    buildTranslationMessages: vi.fn(({ content }: { content: string }) => ({ system: `SYS:${content}` })),
    codeToLanguageNameInEnglish: (code: string) => (code === "zh-CN" ? "Chinese (Simplified)" : code),
    formatAiError: (error: unknown) => ({ message: `formatted:${String(error)}` }),
    ...overrides,
  } as CoreLike;
}

const fetchImpl = (async () => {
  throw new Error("no network");
}) as unknown as FetchLike;

function settings(overrides: Record<string, unknown> = {}) {
  return sanitizeSettings({
    engine: "google",
    targetLanguage: "zh-CN",
    aiProvider: "openai",
    aiApiKey: "sk",
    aiModel: "gpt-4o",
    aiBaseUrl: "",
    aiReasoningDepth: LOWEST_REASONING,
    ...overrides,
  });
}

describe("normalizeBlocks", () => {
  it("trims and drops empty entries, keeping order", () => {
    expect(normalizeBlocks([" a ", "", "  b  "])).toEqual(["a", "b"]);
  });
});

describe("bridge — Google", () => {
  it("sends one batched request and keeps the order", async () => {
    const core = stubCore();
    const bridge = createBridge({ core, fetchImpl, getSettings: () => settings() });
    await expect(bridge.translateBlocks([" one ", "two"])).resolves.toEqual(["G:one", "G:two"]);
    expect(core.translateGoogle).toHaveBeenCalledTimes(1);
    expect(core.translateGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ sourceArray: ["one", "two"], sourceLanguage: "auto", targetLanguage: "zh-CN" }),
    );
  });

  it("does not touch the network for empty input", async () => {
    const core = stubCore();
    const bridge = createBridge({ core, fetchImpl, getSettings: () => settings() });
    await expect(bridge.translateBlocks(["   "])).resolves.toEqual([]);
    expect(core.translateGoogle).not.toHaveBeenCalled();
  });
});

describe("bridge — AI", () => {
  it("forwards provider, model, key, store and resolved reasoning", async () => {
    const core = stubCore({
      streamChat: vi.fn(async ({ onChunk }: { onChunk?: (text: string) => void }) => {
        onChunk?.("译文");
        return { totalChunks: 1, streamError: null };
      }) as unknown as CoreLike["streamChat"],
    });
    const store = { getProvidersData: async () => ({}) };
    const bridge = createBridge({
      core,
      fetchImpl,
      getSettings: () => settings({ engine: "ai", aiReasoningDepth: "low" }),
      getStore: () => store,
      resolveReasoningDepth: () => "low",
    });
    await expect(bridge.translateBlocks(["Hello"])).resolves.toEqual(["译文"]);
    expect(core.buildTranslationMessages).toHaveBeenCalledWith({ content: "Hello", targetLanguageName: "Chinese (Simplified)" });
    expect(core.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        apiKey: "sk",
        model: "gpt-4o",
        store,
        fetch: fetchImpl,
        reasoningDepth: "low",
        extra: {},
      }),
    );
  });

  it("passes the endpoint override as baseURL", async () => {
    const core = stubCore();
    const bridge = createBridge({
      core,
      fetchImpl,
      getSettings: () => settings({ engine: "ai", aiBaseUrl: "https://proxy.example/v1" }),
    });
    await bridge.translateBlocks(["Hello"]);
    expect(core.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ extra: { baseURL: "https://proxy.example/v1" } }),
    );
  });

  it("maps a stream error through formatAiError", async () => {
    const core = stubCore({
      streamChat: vi.fn(async () => ({ totalChunks: 0, streamError: new Error("401") })) as unknown as CoreLike["streamChat"],
    });
    const bridge = createBridge({ core, fetchImpl, getSettings: () => settings({ engine: "ai" }) });
    await expect(bridge.translateBlocks(["Hello"])).rejects.toThrow(/formatted/);
  });

  it("refuses an empty model before touching the core", async () => {
    const core = stubCore();
    const bridge = createBridge({ core, fetchImpl, getSettings: () => settings({ engine: "ai", aiModel: "" }) });
    await expect(bridge.translateBlocks(["Hello"])).rejects.toThrow(/model/i);
    expect(core.streamChat).not.toHaveBeenCalled();
  });
});
