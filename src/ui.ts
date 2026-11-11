/**
 * Settings panel rendered inside the plugin's own iframe (shown with
 * logseq.showMainUI()). Logseq's schema settings can only render
 * `<option value === label>` enums and never refresh a model list in place, so
 * provider→model→endpoint wiring and readable labels live here.
 *
 * Pure DOM + injected data: no Logseq import, testable under jsdom.
 */
import {
  CUSTOM_MODEL,
  CUSTOM_PROVIDER,
  effectiveBaseUrl,
  languageOptions,
  modelsForProvider,
  pickModelForProvider,
  projectProviders,
  reasoningDepthChoices,
  resolveEndpointOnProviderChange,
  summarizeCatalog,
  withCurrentModel,
  type ModelOption,
  type ModelsDevData,
  type ProviderDef,
} from "./catalog";
import { LOWEST_REASONING, type DualTranSettings } from "./settings";
import { LOCALE_NAMES, isRtl, type Translator } from "./i18n";

export interface PanelDeps {
  t: Translator["t"];
  locale: string;
  version: string;
  getSettings(): DualTranSettings;
  update(patch: Partial<DualTranSettings>): void;
  catalog(): ModelsDevData | null;
  catalogState(): "loading" | "ready" | "offline";
  refreshCatalog(): Promise<void>;
  /** Language names in the current UI language (keyed by translation code). */
  languageNames(): Record<string, string>;
  builtIns: ProviderDef[];
  resolveId(id: string): string;
  smartDefault(args: { provider: string; models: ModelOption[] }): string | null;
  reasoningOptions(provider: string, model: string): Array<{ value: string; label?: string }>;
  close(): void;
  /** Re-render from the host (used after language / provider / model changes). */
  rerender(): void;
}

const STYLE_ID = "dualtran-panel-style";

const CSS = `
.dt-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:var(--ls-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);}
.dt-panel{width:min(720px,100%);max-height:86vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
  background:var(--ls-primary-background-color,#fff);color:var(--ls-primary-text-color,#1f2328);
  border:1px solid var(--ls-border-color,#d0d7de);box-shadow:0 24px 64px rgba(0,0,0,.35);}
.dt-head{display:flex;align-items:center;gap:10px;padding:16px 22px;border-bottom:1px solid var(--ls-border-color,#d0d7de);}
.dt-head h1{font-size:17px;font-weight:600;margin:0;line-height:1.3;}
.dt-ver{font-size:12px;opacity:.55;}
.dt-close{margin-inline-start:auto;border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;opacity:.6;padding:2px 6px;border-radius:6px;}
.dt-close:hover{opacity:1;background:var(--ls-secondary-background-color,#f3f4f6);}
.dt-body{padding:6px 22px 18px;overflow-y:auto;}
.dt-sec{padding-top:14px;}
.dt-sec h2{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;opacity:.55;margin:0 0 8px;}
.dt-row{padding:9px 0;border-bottom:1px solid var(--ls-border-color,#eaeef2);}
.dt-row:last-child{border-bottom:0;}
.dt-label{font-size:13px;font-weight:600;line-height:1.4;}
.dt-desc{font-size:12px;opacity:.62;line-height:1.45;margin-top:2px;}
.dt-control{display:flex;align-items:center;gap:8px;margin-top:7px;}
.dt-control>select,.dt-control>input{flex:1;min-width:0;height:34px;padding:0 9px;font-size:13px;font-family:inherit;border-radius:6px;
  border:1px solid var(--ls-border-color,#d0d7de);background:var(--ls-primary-background-color,#fff);color:inherit;}
.dt-control>select:focus,.dt-control>input:focus{outline:2px solid var(--ls-link-text-color,#0969da);outline-offset:1px;}
.dt-control>select:disabled,.dt-control>input:disabled{opacity:.55;}
.dt-btn{height:34px;padding:0 12px;font-size:12px;font-family:inherit;border-radius:6px;cursor:pointer;white-space:nowrap;
  border:1px solid var(--ls-border-color,#d0d7de);background:var(--ls-secondary-background-color,#f6f8fa);color:inherit;}
.dt-btn:hover:not(:disabled){border-color:var(--ls-link-text-color,#0969da);color:var(--ls-link-text-color,#0969da);}
.dt-btn:disabled{opacity:.6;cursor:default;}
.dt-status{font-size:12px;opacity:.7;}
.dt-status-row{display:flex;align-items:center;gap:10px;margin-top:6px;}
.dt-foot{padding:10px 22px 14px;border-top:1px solid var(--ls-border-color,#d0d7de);font-size:11px;opacity:.5;display:flex;justify-content:flex-end;gap:12px;}
.dt-panel[dir="rtl"] .dt-foot{justify-content:flex-start;}
.dt-panel[dir="rtl"] .dt-close{margin-inline-start:auto;}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

interface RowSpec {
  label: string;
  desc?: string;
}

function row(doc: Document, spec: RowSpec): { root: HTMLDivElement; control: HTMLDivElement } {
  const root = doc.createElement("div");
  root.className = "dt-row";
  const label = doc.createElement("div");
  label.className = "dt-label";
  label.textContent = spec.label;
  root.appendChild(label);
  if (spec.desc) {
    const desc = doc.createElement("div");
    desc.className = "dt-desc";
    desc.textContent = spec.desc;
    root.appendChild(desc);
  }
  const control = doc.createElement("div");
  control.className = "dt-control";
  root.appendChild(control);
  return { root, control };
}

function select(doc: Document, value: string): HTMLSelectElement {
  const el = doc.createElement("select");
  el.value = value;
  return el;
}

function option(doc: Document, value: string, label: string, disabled = false): HTMLOptionElement {
  const el = doc.createElement("option");
  el.value = value;
  el.textContent = label;
  el.disabled = disabled;
  el.selected = false;
  return el;
}

/** Render (or re-render) the whole panel into `host`. */
export function renderSettingsPanel(host: HTMLElement, deps: PanelDeps): void {
  const doc = host.ownerDocument;
  ensureStyle(doc);
  const settings = deps.getSettings();
  const data = deps.catalog();
  const t = deps.t;

  host.textContent = "";
  const backdrop = doc.createElement("div");
  backdrop.className = "dt-backdrop";
  backdrop.dataset.dt = "backdrop";
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) deps.close();
  });

  const panel = doc.createElement("section");
  panel.className = "dt-panel";
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", t("panelTitle"));
  if (isRtl(deps.locale)) panel.setAttribute("dir", "rtl");
  backdrop.appendChild(panel);

  // Header
  const head = doc.createElement("header");
  head.className = "dt-head";
  const title = doc.createElement("h1");
  title.textContent = t("panelTitle");
  const ver = doc.createElement("span");
  ver.className = "dt-ver";
  ver.textContent = `v${deps.version}`;
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "dt-close";
  close.setAttribute("aria-label", t("panelClose"));
  close.title = t("panelClose");
  close.textContent = "×";
  close.addEventListener("click", () => deps.close());
  head.append(title, ver, close);
  panel.appendChild(head);

  const body = doc.createElement("div");
  body.className = "dt-body";
  panel.appendChild(body);

  // ── General ────────────────────────────────────────────────────────────
  const general = doc.createElement("section");
  general.className = "dt-sec";
  const generalTitle = doc.createElement("h2");
  generalTitle.textContent = t("sectionGeneral");
  general.appendChild(generalTitle);

  const engineRow = row(doc, { label: t("settingEngine"), desc: t("settingEngineDesc") });
  const engine = select(doc, settings.engine);
  engine.dataset.dt = "engine";
  engine.appendChild(option(doc, "google", t("engineGoogle")));
  engine.appendChild(option(doc, "ai", t("engineAi")));
  engine.value = settings.engine;
  engine.addEventListener("change", () => {
    deps.update({ engine: engine.value === "ai" ? "ai" : "google" });
    deps.rerender();
  });
  engineRow.control.appendChild(engine);
  general.appendChild(engineRow.root);

  const uiLangRow = row(doc, { label: t("settingUiLang"), desc: t("settingUiLangDesc") });
  const uiLang = select(doc, settings.uiLang);
  uiLang.dataset.dt = "uiLang";
  uiLang.appendChild(option(doc, "", t("languageFollowApp")));
  for (const code of Object.keys(LOCALE_NAMES)) {
    uiLang.appendChild(option(doc, code, LOCALE_NAMES[code]));
  }
  uiLang.value = settings.uiLang;
  uiLang.addEventListener("change", () => {
    deps.update({ uiLang: uiLang.value });
    deps.rerender();
  });
  uiLangRow.control.appendChild(uiLang);
  general.appendChild(uiLangRow.root);
  body.appendChild(general);

  // ── Translation ────────────────────────────────────────────────────────
  const translation = doc.createElement("section");
  translation.className = "dt-sec";
  const translationTitle = doc.createElement("h2");
  translationTitle.textContent = t("sectionTranslation");
  translation.appendChild(translationTitle);

  const targetRow = row(doc, { label: t("settingTarget"), desc: t("settingTargetDesc") });
  const target = select(doc, settings.targetLanguage);
  target.dataset.dt = "target";
  for (const entry of languageOptions({ names: deps.languageNames(), current: settings.targetLanguage })) {
    target.appendChild(option(doc, entry.value, entry.text));
  }
  target.value = settings.targetLanguage;
  target.addEventListener("change", () => deps.update({ targetLanguage: target.value }));
  targetRow.control.appendChild(target);
  translation.appendChild(targetRow.root);
  body.appendChild(translation);

  // ── AI ──────────────────────────────────────────────────────────────────
  const ai = doc.createElement("section");
  ai.className = "dt-sec";
  const aiTitle = doc.createElement("h2");
  aiTitle.textContent = t("sectionAi");
  ai.appendChild(aiTitle);

  const providers = projectProviders({
    data,
    builtIns: deps.builtIns,
    selectedId: settings.aiProvider,
    resolveId: deps.resolveId,
  });
  const providerRow = row(doc, { label: t("settingProvider"), desc: t("settingProviderDesc") });
  const provider = select(doc, settings.aiProvider);
  provider.dataset.dt = "provider";
  // One alphabetical list: the user does not care which providers are built in.
  // The custom entry is an action, not a provider, so it stays at the end.
  for (const entry of providers) {
    const label = entry.source === "custom" ? t("providerCustomOption") : entry.label;
    provider.appendChild(option(doc, entry.id, label));
  }
  provider.value = settings.aiProvider;
  provider.addEventListener("change", () => {
    if (provider.value === settings.aiProvider) return;
    const nextProvider = provider.value;
    const current = deps.getSettings();
    const models = nextProvider === CUSTOM_PROVIDER
      ? []
      : modelsForProvider({ provider: nextProvider, data, resolveId: deps.resolveId });
    const nextModel =
      nextProvider === CUSTOM_PROVIDER
        ? current.aiModel
        : pickModelForProvider({
            models,
            current: current.aiModel,
            provider: nextProvider,
            smartDefault: deps.smartDefault,
          }) || current.aiModel;
    const nextEndpoint = resolveEndpointOnProviderChange({
      current: current.aiBaseUrl,
      previousProvider: current.aiProvider,
      nextProvider,
      data,
      builtIns: deps.builtIns,
      resolveId: deps.resolveId,
    });
    deps.update({ aiProvider: nextProvider, aiModel: nextModel, aiBaseUrl: nextEndpoint });
    deps.rerender();
  });
  providerRow.control.appendChild(provider);
  ai.appendChild(providerRow.root);

  const keyRow = row(doc, { label: t("settingApiKey"), desc: t("settingApiKeyDesc") });
  const keyInput = doc.createElement("input");
  keyInput.type = "password";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.dataset.dt = "apiKey";
  keyInput.placeholder = t("placeholderApiKey");
  keyInput.value = settings.aiApiKey;
  let keyTimer: ReturnType<typeof setTimeout> | null = null;
  keyInput.addEventListener("input", () => {
    if (keyTimer) clearTimeout(keyTimer);
    keyTimer = setTimeout(() => deps.update({ aiApiKey: keyInput.value.trim() }), 300);
  });
  keyRow.control.appendChild(keyInput);
  ai.appendChild(keyRow.root);

  const allModels =
    settings.aiProvider === CUSTOM_PROVIDER
      ? []
      : modelsForProvider({ provider: settings.aiProvider, data, resolveId: deps.resolveId });
  const models = withCurrentModel(allModels, settings.aiModel);
  const modelIsListed = !!settings.aiModel && allModels.some((model) => model.value === settings.aiModel);
  const customModel = allModels.length === 0 || (!!settings.aiModel && !modelIsListed);
  let shownModel = settings.aiModel;
  if (!shownModel && allModels.length > 0) {
    shownModel =
      pickModelForProvider({
        models: allModels,
        current: "",
        provider: settings.aiProvider,
        smartDefault: deps.smartDefault,
      }) || allModels[0].value;
    deps.update({ aiModel: shownModel });
  }
  const modelRow = row(doc, { label: t("settingModel"), desc: t("settingModelDesc") });
  const model = select(doc, customModel ? CUSTOM_MODEL : shownModel);
  model.dataset.dt = "model";
  for (const entry of models) {
    const label = entry.text === entry.value ? entry.text : `${entry.text} (${entry.value})`;
    model.appendChild(option(doc, entry.value, label));
  }
  model.appendChild(option(doc, CUSTOM_MODEL, t("customModelOption")));
  model.value = customModel ? CUSTOM_MODEL : shownModel;
  model.addEventListener("change", () => {
    if (model.value === CUSTOM_MODEL) {
      deps.rerender();
      return;
    }
    deps.update({ aiModel: model.value });
    deps.rerender();
  });
  modelRow.control.appendChild(model);
  ai.appendChild(modelRow.root);

  const showCustomModel = settings.aiProvider === CUSTOM_PROVIDER || customModel;
  if (showCustomModel) {
    const customRow = row(doc, { label: t("settingCustomModel"), desc: t("settingCustomModelDesc") });
    const customInput = doc.createElement("input");
    customInput.type = "text";
    customInput.dataset.dt = "customModel";
    customInput.placeholder = t("placeholderModelId");
    customInput.value = settings.aiModel;
    let timer: ReturnType<typeof setTimeout> | null = null;
    customInput.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => deps.update({ aiModel: customInput.value.trim() }), 300);
    });
    customRow.control.appendChild(customInput);
    ai.appendChild(customRow.root);
  }

  const endpointDefault = effectiveBaseUrl({
    provider: settings.aiProvider,
    data,
    builtIns: deps.builtIns,
    resolveId: deps.resolveId,
  });
  const endpointRow = row(doc, { label: t("settingEndpoint"), desc: t("settingEndpointDesc") });
  const endpoint = doc.createElement("input");
  endpoint.type = "text";
  endpoint.dataset.dt = "endpoint";
  endpoint.placeholder = endpointDefault || t("placeholderEndpoint");
  endpoint.value = settings.aiBaseUrl || endpointDefault;
  let endpointTimer: ReturnType<typeof setTimeout> | null = null;
  endpoint.addEventListener("input", () => {
    if (endpointTimer) clearTimeout(endpointTimer);
    endpointTimer = setTimeout(() => deps.update({ aiBaseUrl: endpoint.value.trim() }), 300);
  });
  const reset = doc.createElement("button");
  reset.type = "button";
  reset.className = "dt-btn";
  reset.dataset.dt = "resetEndpoint";
  reset.textContent = t("btnResetEndpoint");
  reset.addEventListener("click", () => {
    endpoint.value = endpointDefault;
    deps.update({ aiBaseUrl: "" });
  });
  endpointRow.control.append(endpoint, reset);
  ai.appendChild(endpointRow.root);

  const declared = deps.reasoningOptions(settings.aiProvider, settings.aiModel);
  const hasLevels = declared.some((option) => option.value !== "");
  const reasoningChoices = reasoningDepthChoices({ options: declared, t });
  const storedReasoning = reasoningChoices.some((choice) => choice.value === settings.aiReasoningDepth)
    ? settings.aiReasoningDepth
    : LOWEST_REASONING;
  // Only normalise once the catalogue is loaded — an unloaded panel would wipe
  // a valid explicit level. Same guard as Obsidian's settings pane.
  if (deps.catalogState() === "ready" && storedReasoning !== settings.aiReasoningDepth) {
    deps.update({ aiReasoningDepth: LOWEST_REASONING });
  }
  const reasoningRow = row(doc, {
    label: t("settingReasoning"),
    desc: hasLevels ? t("settingReasoningDesc") : t("settingReasoningInert"),
  });
  const reasoning = select(doc, storedReasoning);
  reasoning.dataset.dt = "reasoning";
  reasoning.disabled = !hasLevels;
  for (const choice of reasoningChoices) reasoning.appendChild(option(doc, choice.value, choice.text));
  reasoning.value = storedReasoning;
  reasoning.addEventListener("change", () => deps.update({ aiReasoningDepth: reasoning.value }));
  reasoningRow.control.appendChild(reasoning);
  ai.appendChild(reasoningRow.root);
  body.appendChild(ai);

  // ── Catalogue ───────────────────────────────────────────────────────────
  const catalogue = doc.createElement("section");
  catalogue.className = "dt-sec";
  const catalogueTitle = doc.createElement("h2");
  catalogueTitle.textContent = t("sectionData");
  catalogue.appendChild(catalogueTitle);
  const status = doc.createElement("div");
  status.className = "dt-row";
  const statusText = doc.createElement("div");
  statusText.className = "dt-status";
  const state = deps.catalogState();
  const summary = summarizeCatalog(data);
  statusText.dataset.dt = "catalogStatus";
  statusText.textContent =
    state === "loading"
      ? t("catalogLoading")
      : state === "offline" || summary.offline
        ? t("catalogOffline")
        : t("catalogSummary", { PROVIDERS: summary.providerCount, MODELS: summary.modelCount });
  const statusRow = doc.createElement("div");
  statusRow.className = "dt-status-row";
  const refresh = doc.createElement("button");
  refresh.type = "button";
  refresh.className = "dt-btn";
  refresh.dataset.dt = "refresh";
  refresh.textContent = state === "loading" ? t("btnRefreshing") : t("btnRefresh");
  refresh.disabled = state === "loading";
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    refresh.textContent = t("btnRefreshing");
    try {
      await deps.refreshCatalog();
    } finally {
      deps.rerender();
    }
  });
  statusRow.append(statusText, refresh);
  status.appendChild(statusRow);
  catalogue.appendChild(status);
  body.appendChild(catalogue);

  // Footer
  const foot = doc.createElement("footer");
  foot.className = "dt-foot";
  const version = doc.createElement("span");
  version.textContent = t("aboutVersion", { VERSION: deps.version });
  foot.append(version);
  panel.appendChild(foot);

  host.appendChild(backdrop);
  panel.focus();
}
