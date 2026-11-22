import { DEFAULT_RULES } from "./url-parser.js";

export const DEFAULT_SETTINGS = {
  clientId: "",
  clientSecret: "",
  openOnRecord: true,
  sites: DEFAULT_RULES,
};

const LIST_FIELDS = ["listStatus", "paused", "pausedEpisode", "lastRecorded", "pendingEpisode"];

export function createStore(area) {
  const storage = () => area ?? browser.storage.local;

  async function read(key) {
    return (await storage().get(key))[key];
  }
  async function readMap(key, entry) {
    return (await read(key))?.[entry];
  }
  async function writeMap(key, entry, value) {
    const map = (await read(key)) ?? {};
    map[entry] = value;
    await storage().set({ [key]: map });
  }

  return {
    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...(await read("settings")) };
    },
    saveSettings: (settings) => storage().set({ settings }),
    async getAuth() {
      return (await read("auth")) ?? null;
    },
    setAuth: (auth) => storage().set({ auth }),
    clearAuth: () => storage().remove("auth"),
    async isSignedIn() {
      return Boolean((await read("auth"))?.accessToken);
    },
    getMapping: (key) => readMap("mappings", key),
    setMapping: (key, mapping) => writeMap("mappings", key, mapping),
    getLastSeen: (key) => readMap("lastSeen", key),
    setLastSeen: (key, value) => writeMap("lastSeen", key, value),
    async clearLastSeen(key) {
      const map = (await read("lastSeen")) ?? {};
      delete map[key];
      await storage().set({ lastSeen: map });
    },
    // Drops what was read from one account's list. Which anime a show is stays.
    async clearListState() {
      const map = await read("mappings");
      if (!map) return;
      for (const mapping of Object.values(map)) {
        for (const field of LIST_FIELDS) delete mapping[field];
      }
      await storage().set({ mappings: map });
    },
    async takeJustRecorded() {
      const value = (await read("justRecorded")) ?? null;
      if (value) await storage().remove("justRecorded");
      return value;
    },
    setJustRecorded: (justRecorded) => storage().set({ justRecorded }),
    async getTeach() {
      return (await read("teach")) ?? null;
    },
    setTeach: (teach) => storage().set({ teach }),
    clearTeach: () => storage().remove("teach"),
  };
}
