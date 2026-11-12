import "@logseq/libs";
import { createBridge, type CoreLike, type FetchLike } from "./bridge";
import type { CatalogCore, ModelOption, ModelsDevData, ModelsDevStore, ProviderDef, ReasoningOption } from "./catalog";
import { modelReasoningOptions, resolveReasoningDepth } from "./catalog";
import { coreNamespace } from "./coreAdapter";
import { LOCALE_CODES, createTranslator, pickLanguageTable } from "./i18n";
import { readSettings, sanitizeSettings, type DualTranSettings } from "./settings";
import { createLocalStorageAdapter } from "./storage";
import { chunkText, describeFetchFailure, providerRequiredMessage } from "./translate";
import { renderSettingsPanel } from "./ui";

declare const __VERSION__: string;

type FullCore = CoreLike & CatalogCore;

const core = coreNamespace as unknown as FullCore;

let translator = createTranslator("en");
let locale = "en";
let hostLanguage = "en";
let current: DualTranSettings = sanitizeSettings({});
let store!: ModelsDevStore;
let catalogData: ModelsDevData | null = null;
let catalogState: "loading" | "ready" | "offline" = "loading";
let builtIns: ProviderDef[] = [];
let panelOpen = false;
let suppressSettingsEvent = false;
let schemaSupportsButton = false;
let loadingKey: string | null = null;

const SETTINGS_PANEL_ID = "dualtran-settings-root";

function settings(): DualTranSettings {
  return current;
}

/** Persist a patch and keep the in-memory copy authoritative (logseq.settings lags). */
function persist(patch: Partial<DualTranSettings>): void {
  suppressSettingsEvent = true;
  try {
    logseq.updateSettings(patch as Record<string, unknown>);
  } finally {
    suppressSettingsEvent = false;
  }
  current = sanitizeSettings({ ...current, ...patch });
}

function applyLanguage(): void {
  translator = createTranslator(current.uiLang || hostLanguage);
  locale = translator.code;
}

function languageNames(): Record<string, string> {
  return pickLanguageTable(core.allLanguagesNames || {}, locale);
}

function reasoningOptions(provider: string, model: string): Array<{ value: string; label?: string }> {
  if (!core.buildReasoningDepthOptions) return [];
  const raw: ReasoningOption[] = modelReasoningOptions({
    data: catalogData,
    resolveId: core.resolveModelsDevId,
    provider,
    model,
  });
  const npm = catalogData?.[core.resolveModelsDevId(provider)]?.npm;
  return core.buildReasoningDepthOptions({
    provider,
    npm,
    reasoningOptions: raw,
    translate: (key, fallback) => {
      const value = translator.t(key);
      return value === key ? fallback : value;
    },
  });
}

// ── Translation ────────────────────────────────────────────────────────────

function bridge() {
  return createBridge({
    core,
    // The plugin iframe is an ordinary browser context: providers must answer
    // CORS. Failures are reported with that hint instead of a bare network error.
    fetchImpl: ((url: string, init?: unknown) => fetch(url, init as RequestInit)) as unknown as FetchLike,
    getSettings: settings,
    getStore: () => store,
    resolveReasoningDepth: (value) =>
      resolveReasoningDepth({ setting: value.aiReasoningDepth, options: reasoningOptions(value.aiProvider, value.aiModel) }),
    providerRequiredError: () => providerRequiredMessage(translator.t),
  });
}

async function translateText(text: string): Promise<string> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return "";
  const results = await bridge().translateBlocks(chunks);
  return results.join("\n\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let loadingToken = 0;

function showLoading(message: string): void {
  if (loadingKey) {
    void logseq.UI.showMsg(message, "info", { key: loadingKey, timeout: 0 });
    return;
  }
  const token = ++loadingToken;
  void logseq.UI.showMsg(message, "info", { timeout: 0 }).then((key) => {
    // The translation may finish before the toast resolves; close it late
    // instead of leaving a permanent "Translating…".
    if (token === loadingToken) loadingKey = key;
    else logseq.UI.closeMsg(key);
  });
}

function hideLoading(): void {
  loadingToken += 1;
  if (!loadingKey) return;
  logseq.UI.closeMsg(loadingKey);
  loadingKey = null;
}

// ── Commands ───────────────────────────────────────────────────────────────

/** SPEC 2.1: AI mode with no provider configured — the commands refuse to run. */
function providerMissing(): boolean {
  return current.engine === "ai" && !current.aiProvider.trim();
}

async function translateCurrentBlock(): Promise<void> {
  const block = await logseq.Editor.getCurrentBlock();
  if (!block) {
    await logseq.UI.showMsg(translator.t("noticeNoBlock"), "warning");
    return;
  }
  const source = (block.content || "").trim();
  if (!source) {
    await logseq.UI.showMsg(translator.t("noticeEmptyBlock"), "warning");
    return;
  }
  if (current.engine === "ai" && !current.aiModel) {
    await logseq.UI.showMsg(
      providerMissing()
        ? providerRequiredMessage(translator.t)
        : translator.t("noticeNoModel"),
      "warning",
    );
    openSettingsPanel();
    return;
  }
  showLoading(translator.t("noticeLoadingBlock"));
  try {
    const translated = await translateText(source);
    await logseq.Editor.insertBlock(block.uuid, translated, { sibling: true });
  } catch (error) {
    hideLoading();
    await logseq.UI.showMsg(translator.t("noticeTranslateFailed", { DETAIL: describeFetchFailure(error, "") }), "error");
    return;
  } finally {
    hideLoading();
  }
}

async function translateCurrentPage(): Promise<void> {
  const page = await logseq.Editor.getCurrentPage();
  if (!page || typeof page === "string") {
    await logseq.UI.showMsg(translator.t("noticeNoPage"), "warning");
    return;
  }
  const blocks = (await logseq.Editor.getCurrentPageBlocksTree()) || [];
  if (!blocks.length) {
    await logseq.UI.showMsg(translator.t("noticeEmptyPage"), "warning");
    return;
  }
  if (current.engine === "ai" && !current.aiModel) {
    await logseq.UI.showMsg(
      providerMissing() ? providerRequiredMessage(translator.t) : translator.t("noticeNoModel"),
      "warning",
    );
    openSettingsPanel();
    return;
  }
  try {
    const target = current.targetLanguage;
    const title = `${page.name} · ${target}`;
    const existing = await logseq.Editor.getPage(title);
    if (existing) {
      await logseq.UI.showMsg(translator.t("noticePageExists", { NAME: title }), "warning");
      return;
    }
    const created = await logseq.Editor.createPage(title, {}, { createFirstBlock: false, redirect: false });
    if (!created) throw new Error(`Could not create page "${title}"`);
    const todo = blocks.filter((block) => (block.content || "").trim());
    let done = 0;
    showLoading(translator.t("noticeLoadingPage", { DONE: 0, TOTAL: todo.length }));
    for (const block of todo) {
      const translated = await translateText((block.content || "").trim());
      await logseq.Editor.appendBlockInPage(created.uuid, translated);
      done += 1;
      showLoading(translator.t("noticeLoadingPage", { DONE: done, TOTAL: todo.length }));
    }
    await logseq.Editor.openInRightSidebar(created.uuid);
  } catch (error) {
    hideLoading();
    await logseq.UI.showMsg(translator.t("noticePageFailed", { DETAIL: errorMessage(error) }), "error");
    return;
  } finally {
    hideLoading();
  }
}

// ── Settings panel ─────────────────────────────────────────────────────────

function rerenderPanel(): void {
  if (!panelOpen) return;
  let root = document.getElementById(SETTINGS_PANEL_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = SETTINGS_PANEL_ID;
    document.body.appendChild(root);
  }
  renderSettingsPanel(root, {
    t: translator.t,
    locale,
    version: __VERSION__,
    getSettings: settings,
    update: (patch) => {
      persist(patch);
      if (typeof patch.uiLang === "string") {
        applyLanguage();
        // Command/slash labels cannot be re-registered under the same key in
        // Logseq (no unregister API), so they keep the load-time language; the
        // panel and the native schema follow immediately.
        registerSchema();
        rerenderPanel();
      }
    },
    catalog: () => catalogData,
    catalogState: () => catalogState,
    refreshCatalog: async () => {
      await loadCatalog(true);
    },
    languageNames,
    builtIns,
    resolveId: (id) => core.resolveModelsDevId(id),
    smartDefault: ({ provider, models }: { provider: string; models: ModelOption[] }) =>
      core.getSmartDefaultModel({ provider, models }),
    reasoningOptions,
    close: closeSettingsPanel,
    rerender: rerenderPanel,
  });
}

function openSettingsPanel(): void {
  panelOpen = true;
  if (!document.getElementById(SETTINGS_PANEL_ID)) {
    const root = document.createElement("div");
    root.id = SETTINGS_PANEL_ID;
    document.body.appendChild(root);
  }
  logseq.setMainUIInlineStyle({ position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh", zIndex: 100000 });
  rerenderPanel();
  logseq.showMainUI({ autoFocus: true });
  if (catalogState === "loading") void loadCatalog(false);
}

function closeSettingsPanel(): void {
  panelOpen = false;
  document.getElementById(SETTINGS_PANEL_ID)?.remove();
  logseq.hideMainUI({ restoreEditingCursor: true });
}

// ── Catalog ────────────────────────────────────────────────────────────────

function typingInsidePanel(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName;
  return (tag === "INPUT" || tag === "TEXTAREA") && !!document.getElementById(SETTINGS_PANEL_ID)?.contains(active);
}

async function loadCatalog(force: boolean): Promise<void> {
  catalogState = "loading";
  if (panelOpen && !typingInsidePanel()) rerenderPanel();
  try {
    if (force) await store.refreshProvidersData();
    catalogData = await store.getProvidersData();
    catalogState = catalogData ? "ready" : "offline";
  } catch {
    catalogState = catalogData ? "ready" : "offline";
  }
  if (panelOpen && !typingInsidePanel()) rerenderPanel();
}

async function refreshCatalogCommand(): Promise<void> {
  await loadCatalog(true);
  await logseq.UI.showMsg(translator.t("noticeCatalogRefreshed"), "success");
}

// ── Native settings schema (entry point into the panel) ────────────────────

function registerSchema(): void {
  const schema: Array<Record<string, unknown>> = [
    {
      key: "dualtranPanelHeading",
      type: "heading",
      default: null,
      title: "DualTran Translate",
      description: translator.t("nativeSettingsHint"),
    },
  ];
  if (schemaSupportsButton) {
    schema.push({
      key: "dualtranOpenPanel",
      type: "button",
      default: null,
      title: "DualTran",
      buttonText: translator.t("nativeOpenButton"),
      buttonAction: "openDualTranSettings",
    });
  }
  logseq.useSettingsSchema(schema as unknown as Parameters<typeof logseq.useSettingsSchema>[0]);
}

function registerCommands(): void {
  logseq.Editor.registerSlashCommand(translator.t("cmdTranslateBlock"), translateCurrentBlock);
  logseq.Editor.registerSlashCommand(translator.t("cmdTranslatePage"), translateCurrentPage);
  logseq.App.registerCommandPalette(
    { key: "dualtran-translate-block", label: translator.t("cmdTranslateBlock") },
    translateCurrentBlock,
  );
  logseq.App.registerCommandPalette(
    { key: "dualtran-translate-page", label: translator.t("cmdTranslatePage") },
    translateCurrentPage,
  );
  logseq.App.registerCommandPalette(
    { key: "dualtran-settings", label: translator.t("cmdOpenSettings") },
    openSettingsPanel,
  );
  logseq.App.registerCommandPalette(
    { key: "dualtran-refresh-catalog", label: translator.t("cmdRefreshCatalog") },
    refreshCatalogCommand,
  );
}

function supportsButtonSchema(version: string): boolean {
  const major = Number(String(version || "").split(".")[0]);
  return Number.isFinite(major) && major >= 2;
}

async function main(): Promise<void> {
  const configs = (await logseq.App.getUserConfigs()) as { preferredLanguage?: string } | null;
  hostLanguage = (configs?.preferredLanguage as string) || "en";
  builtIns = core.BUILT_IN_PROVIDERS || [];

  const supported = Object.keys(core.allLanguagesNames?.en || {});
  const migrated = readSettings(logseq.settings, {
    preferredLanguage: hostLanguage,
    supportedLanguages: supported.length ? supported : ["en"],
  });
  current = migrated.settings;
  if (migrated.migrated) {
    suppressSettingsEvent = true;
    try {
      logseq.updateSettings(migrated.patch);
    } finally {
      suppressSettingsEvent = false;
    }
  }
  applyLanguage();

  store = core.createModelsDevStore({
    storage: createLocalStorageAdapter(window.localStorage),
    fetch: ((url: string, init?: RequestInit) => fetch(url, init)) as unknown,
    now: () => Date.now(),
    cacheKey: "dualtran:modelsdev:v1",
  });

  let version = "";
  try {
    version = String(await logseq.App.getInfo("version"));
  } catch {
    version = "";
  }
  schemaSupportsButton = supportsButtonSchema(version);

  logseq.provideModel({ openDualTranSettings: openSettingsPanel });
  registerCommands();
  registerSchema();

  logseq.onSettingsChanged((next) => {
    if (suppressSettingsEvent) return;
    const before = current;
    current = sanitizeSettings(next);
    if (current.uiLang !== before.uiLang) {
      applyLanguage();
      registerSchema();
      if (panelOpen) rerenderPanel();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (panelOpen && event.key === "Escape") {
      event.preventDefault();
      closeSettingsPanel();
    }
  });

  console.log(`[dualtran] ready v${__VERSION__} · ${LOCALE_CODES.length} locales`);
  void loadCatalog(false);
}

logseq.ready(main).catch(console.error);
