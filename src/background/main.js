import { createStore } from "../lib/store.js";
import { createAuth } from "../lib/oauth.js";
import { createApi } from "../lib/mal-api.js";
import { createTracker } from "../lib/tracker.js";
import { BUILT_IN_CLIENT_ID, resolveClient } from "../lib/config.js";
import { parseUrl, detectGeneric, validateRules, GENERIC_PATTERN } from "../lib/url-parser.js";

const store = createStore();
const auth = createAuth({ store });
const api = createApi({ tokens: auth });

async function notify(message) {
  // Must never throw. By now the caller has already written to storage or MAL.
  try {
    const { notifications } = await store.getSettings();
    if (notifications === false) return;
    await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon.svg"),
      title: "NextEp",
      message,
    });
  } catch (e) {
    console.error("NextEp: notification failed:", e);
  }
}

const tracker = createTracker({ store, api, notify });

async function updateBadge(tabId, url) {
  const { sites } = await store.getSettings();
  const parsed = parseUrl(url, sites);
  let text = "";
  if (parsed) {
    if (!(await store.isSignedIn())) text = "!";
    else {
      const mapping = await store.getMapping(parsed.key);
      if (!mapping || !mapping.confirmed || mapping.malId === null) text = "?";
    }
  }
  await browser.browserAction.setBadgeText({ tabId, text });
}

async function refreshActiveBadge() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.url) await updateBadge(tab.id, tab.url);
}

browser.tabs.onUpdated.addListener(
  async (tabId, changeInfo) => {
    if (!changeInfo.url) return;
    try {
      const { sites } = await store.getSettings();
      const parsed = parseUrl(changeInfo.url, sites);
      if (parsed) await tracker.handleVisit(parsed);
    } catch (e) {
      console.error("NextEp:", e);
    }
    await updateBadge(tabId, changeInfo.url).catch(() => {});
  },
  { properties: ["url"] },
);

const MATCH_FIELDS = "media_type,num_episodes,start_season";

const handlers = {
  async getState({ url }) {
    const settings = await store.getSettings();
    const { sites } = settings;
    const parsed = parseUrl(url, sites);
    const signedIn = await store.isSignedIn();
    const state = {
      signedIn,
      hasClientId: Boolean(resolveClient(settings).clientId),
      parsed,
      generic: parsed ? null : detectGeneric(url),
      mapping: null,
      anime: null,
    };
    // The page may have been opened while signed out, so no mapping exists yet.
    if (signedIn && parsed) {
      try {
        await tracker.ensureMapping(parsed.key, parsed.slug);
      } catch (e) {
        state.apiError = e.message;
      }
    }
    const mapping = parsed ? ((await store.getMapping(parsed.key)) ?? null) : null;
    state.mapping = mapping;
    if (signedIn && mapping?.malId) {
      try {
        const node = await api.details(mapping.malId, "num_episodes,my_list_status");
        state.anime = {
          numEpisodes: node.num_episodes ?? 0,
          listStatus: node.my_list_status ?? null,
        };
      } catch (e) {
        state.apiError ??= e.message;
      }
    }
    return state;
  },

  async setWatched({ key, episodes, force }) {
    if (!Number.isInteger(episodes)) throw new Error("Episode count must be a whole number.");
    const mapping = await store.getMapping(key);
    if (!mapping?.malId) throw new Error("No anime selected for this show.");
    // The popup shows the result, so no desktop notification.
    const result = await tracker.applyProgress(mapping.malId, episodes, {
      force: force === true,
      silent: true,
    });
    return { result };
  },

  async search({ query }) {
    const nodes = await api.search(query, { limit: 10, fields: MATCH_FIELDS });
    return {
      results: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        mediaType: n.media_type,
        numEpisodes: n.num_episodes ?? 0,
        startSeason: n.start_season ?? null,
      })),
    };
  },

  async selectMapping({ key, malId }) {
    return { result: await tracker.selectMapping(key, malId) };
  },

  async enableSite({ url }) {
    const found = detectGeneric(url);
    if (!found) throw new Error("This page doesn't look like an episode page.");
    const settings = await store.getSettings();
    if (!settings.sites.some((r) => r.host === found.host)) {
      const sites = [...settings.sites, { host: found.host, pattern: GENERIC_PATTERN }];
      await store.saveSettings({ ...settings, sites });
      // Record this page so the next episode counts as a step from it.
      const parsed = parseUrl(url, sites);
      if (parsed) {
        try {
          await tracker.handleVisit(parsed);
        } catch (e) {
          console.error("NextEp:", e);
        }
      }
    }
    return {};
  },

  async signIn() {
    await auth.signIn();
    return {};
  },

  async signOut() {
    await auth.signOut();
    return {};
  },

  async getSettings() {
    return {
      settings: await store.getSettings(),
      hasBuiltInClientId: Boolean(BUILT_IN_CLIENT_ID),
    };
  },

  async saveSettings({ settings }) {
    const sites = (settings.sites ?? []).map((r) => ({
      host: String(r.host ?? "").trim().toLowerCase(),
      pattern: String(r.pattern ?? "").trim(),
    }));
    const problem = validateRules(sites);
    if (problem) throw new Error(problem);
    const previous = await store.getSettings();
    const next = {
      clientId: String(settings.clientId ?? "").trim(),
      clientSecret: String(settings.clientSecret ?? "").trim(),
      notifications: settings.notifications !== false,
      sites,
    };
    await store.saveSettings(next);
    // Tokens belong to the client that issued them.
    let signedOut = false;
    if (
      resolveClient(previous).clientId !== resolveClient(next).clientId &&
      (await store.isSignedIn())
    ) {
      await auth.signOut();
      signedOut = true;
    }
    return { signedOut };
  },

  async getRedirectUrl() {
    return { url: browser.identity.getRedirectURL() };
  },
};

const mutating = new Set(["selectMapping", "setWatched", "enableSite", "signIn", "signOut", "saveSettings"]);

browser.runtime.onMessage.addListener(async (message) => {
  try {
    const handler = handlers[message?.type];
    if (!handler) throw new Error(`Unknown message type: ${message?.type}`);
    const data = await handler(message);
    if (mutating.has(message.type)) await refreshActiveBadge().catch(() => {});
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
});
