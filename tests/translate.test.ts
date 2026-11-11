import { describe, expect, it } from "vitest";
import { chunkText, describeFetchFailure } from "../src/translate";

describe("chunking", () => {
  it("keeps short text as one chunk", () => {
    expect(chunkText("hello")).toEqual(["hello"]);
  });

  it("splits on paragraph boundaries before hard-wrapping", () => {
    const text = ["a".repeat(40), "b".repeat(40), "c".repeat(40)].join("\n\n");
    const chunks = chunkText(text, 90);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(90);
  });

  it("hard-wraps a single oversized paragraph", () => {
    expect(chunkText("x".repeat(250), 100)).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });

  it("drops empty input", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });
});

describe("error messages", () => {
  it("names CORS as a cause instead of a bare network error", () => {
    const hint = describeFetchFailure(new TypeError("Failed to fetch"), "https://api.example.com/v1");
    expect(hint).toContain("CORS");
    expect(hint).toContain("https://api.example.com");
  });

  it("works without a url", () => {
    expect(describeFetchFailure(new TypeError("Failed to fetch"))).toContain("the provider");
  });

  it("passes other errors through", () => {
    expect(describeFetchFailure(new Error("boom"), "https://x")).toBe("boom");
  });
});
