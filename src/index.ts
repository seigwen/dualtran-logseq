import "@logseq/libs";
import {
  buildChatRequest,
  chunkText,
  describeFetchFailure,
  googleUrl,
  parseChatResponse,
  parseGoogleResponse,
  type Engine,
} from "./translate";

const SETTINGS_SCHEMA = [
  {
    key: "engine",
    type: "enum",
    title: "Translation engine",
    description: "Google works without a key; AI needs an OpenAI-compatible endpoint.",
    enumChoices: ["google", "ai"],
    default: "google",
  },
  {
    key: "target",
    type: "string",
    title: "Target language",
    description: "Language code, e.g. zh-CN, en, ja.",
    default: "zh-CN",
  },
  {
    key: "endpoint",
    type: "string",
    title: "AI endpoint",
    description: "Base URL, e.g. https://api.openai.com/v1 or http://127.0.0.1:11434/v1",
    default: "https://api.openai.com/v1",
  },
  { key: "apiKey", type: "string", title: "API key", description: "Stored in this graph only.", default: "" },
  { key: "model", type: "string", title: "Model", default: "gpt-4o-mini" },
] as const;

type Settings = { engine: Engine; target: string; endpoint: string; apiKey: string; model: string };

function settings(): Settings {
  const raw = (logseq.settings ?? {}) as Partial<Settings>;
  return {
    engine: (raw.engine as Engine) || "google",
    target: raw.target || "zh-CN",
    endpoint: raw.endpoint || "https://api.openai.com/v1",
    apiKey: raw.apiKey || "",
    model: raw.model || "gpt-4o-mini",
  };
}

async function translateOne(text: string): Promise<string> {
  const config = settings();
  const options = { text, target: config.target };

  if (config.engine === "google") {
    const url = googleUrl(options);
    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch (error) {
      throw new Error(describeFetchFailure(error, url));
    }
    if (!response.ok) throw new Error(`Google Translate answered HTTP ${response.status}`);
    return parseGoogleResponse(await response.json());
  }

  const { url, init } = buildChatRequest(
    { endpoint: config.endpoint, apiKey: config.apiKey, model: config.model },
    options,
  );
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(describeFetchFailure(error, url));
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(`AI endpoint answered HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return parseChatResponse(body);
}

/** Translate a possibly long block: chunk it, translate the pieces, keep the paragraph breaks. */
async function translateText(text: string): Promise<string> {
  const chunks = chunkText(text);
  const out: string[] = [];
  for (const chunk of chunks) out.push(await translateOne(chunk));
  return out.join("\n\n");
}

async function translateCurrentBlock(): Promise<void> {
  const block = await logseq.Editor.getCurrentBlock();
  if (!block) {
    await logseq.UI.showMsg("Put the cursor inside a block first.", "warning");
    return;
  }
  const source = (block.content || "").trim();
  if (!source) {
    await logseq.UI.showMsg("This block is empty.", "warning");
    return;
  }
  try {
    const translated = await translateText(source);
    await logseq.Editor.insertBlock(block.uuid, translated, { sibling: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logseq.UI.showMsg(`Translation failed: ${message}`, "error");
  }
}

async function translateCurrentPage(): Promise<void> {
  const page = await logseq.Editor.getCurrentPage();
  if (!page || typeof page === "string") {
    await logseq.UI.showMsg("Open a page first.", "warning");
    return;
  }
  const blocks = (await logseq.Editor.getCurrentPageBlocksTree()) || [];
  if (!blocks.length) {
    await logseq.UI.showMsg("This page has no blocks.", "warning");
    return;
  }
  try {
    const target = settings().target;
    const title = `${page.name} · ${target}`;
    const existing = await logseq.Editor.getPage(title);
    if (existing) {
      await logseq.UI.showMsg(`Page "${title}" already exists.`, "warning");
      return;
    }
    const created = await logseq.Editor.createPage(title, {}, { createFirstBlock: false, redirect: false });
    if (!created) throw new Error(`Could not create page "${title}"`);
    for (const block of blocks) {
      const source = (block.content || "").trim();
      if (!source) continue;
      const translated = await translateText(source);
      await logseq.Editor.appendBlockInPage(created.uuid, translated);
    }
    await logseq.Editor.openInRightSidebar(created.uuid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logseq.UI.showMsg(`Page translation failed: ${message}`, "error");
  }
}

async function main(): Promise<void> {
  logseq.useSettingsSchema(SETTINGS_SCHEMA as unknown as Parameters<typeof logseq.useSettingsSchema>[0]);

  logseq.Editor.registerSlashCommand("Translate block (below)", translateCurrentBlock);
  logseq.Editor.registerSlashCommand("Translate page to a new page", translateCurrentPage);
  logseq.App.registerCommandPalette(
    { key: "dualtran-translate-block", label: "DualTran: translate block below" },
    translateCurrentBlock,
  );
  logseq.App.registerCommandPalette(
    { key: "dualtran-translate-page", label: "DualTran: translate page to a new page" },
    translateCurrentPage,
  );
  console.log("[dualtran] ready");
}

logseq.ready(main).catch(console.error);
