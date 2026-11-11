/**
 * localStorage ↔ the storage adapter shape @dualtran/core expects
 * (`get(key)` → `{ [key]: value }`, `set({ [key]: value })`).
 *
 * The plugin iframe has a persistent `lsp://logseq.io` origin, so localStorage
 * is device-local and survives restarts — exactly what a 6 MB catalogue cache
 * wants. Every failure is swallowed: running uncached is better than breaking
 * the panel on a quota error.
 */
export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface StorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(obj: Record<string, unknown>): Promise<void>;
}

export function createLocalStorageAdapter(storage: LocalStorageLike): StorageAdapter {
  return {
    async get(key) {
      try {
        const raw = storage.getItem(key);
        if (raw == null) return {};
        return { [key]: JSON.parse(raw) as unknown };
      } catch {
        return {};
      }
    },
    async set(obj) {
      for (const [key, value] of Object.entries(obj)) {
        try {
          storage.setItem(key, JSON.stringify(value));
        } catch {
          // Quota/serialisation failure: run uncached rather than break the panel.
        }
      }
    },
  };
}
