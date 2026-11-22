import { DEFAULT_RULES } from "./url-parser.js";

export const DEFAULT_SETTINGS = {
  clientId: "",
  clientSecret: "",
  notifications: true,
  sites: DEFAULT_RULES,
};

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
    async getTeach() {
      return (await read("teach")) ?? null;
    },
    setTeach: (teach) => storage().set({ teach }),
    clearTeach: () => storage().remove("teach"),
  };
}
