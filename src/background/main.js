import { createStore } from "../lib/store.js";
import { createAuth } from "../lib/oauth.js";
import { createApi } from "../lib/mal-api.js";
import { createTracker } from "../lib/tracker.js";
import { BUILT_IN_CLIENT_ID, resolveClient } from "../lib/config.js";
import {
  parseUrl,
  parseTab,
  pickEpisode,
  visitTrigger,
  hostHasRule,
  detectGeneric,
  validateRules,
  GENERIC_PATTERN,
} from "../lib/url-parser.js";
import { badgeText } from "../lib/badge.js";
import { LIST_STATUSES } from "../lib/progress.js";
import { learnRule } from "../lib/learn.js";
import { toHttpUrl, siteHost, normalizeHost } from "../lib/template.js";

const store = createStore();
const auth = createAuth({ store });
const api = createApi({ tokens: auth });

// Opens the popup for a moment after an automatic step, if that's on and it can work. Every
// failure is ignored: older Firefox rejects the call, and so does a window that isn't focused
// or is fullscreen.
async function showRecorded(event) {
  const { context } = event;
  if (!context?.tabId || typeof browser.browserAction.openPopup !== "function") return;
  const { openOnRecord } = await store.getSettings();
  if (openOnRecord === false) return;
  const [tab, window] = await Promise.all([
    browser.tabs.get(context.tabId),
    browser.windows.get(context.windowId),
  ]);
  if (!tab.active || !window.focused) return;
  await store.setJustRecorded({
    key: event.key,
    count: event.count,
    total: event.total,
    title: event.title,
    completed: event.completed,
    at: Date.now(),
  });
  await browser.browserAction.openPopup({ windowId: context.windowId });
}

// Only a recorded step shows anything. The other events are already visible as the badge.
function onTrackerEvent(event) {
  if (event.type !== "recorded") return;
  // Not awaited. The popup's own requests go through the same queue as this call.
  showRecorded(event).catch(() => {});
}

const tracker = createTracker({ store, api, emit: onTrackerEvent });

const RECORDED_GREEN = "#2e9e5b";

async function setBadge(tabId, text) {
  await browser.browserAction.setBadgeText({ tabId, text });
  // null puts the default colour back for this tab.
  await browser.browserAction.setBadgeBackgroundColor({
    tabId,
    color: text === "✓" ? RECORDED_GREEN : null,
  });
}

async function updateBadge(tabId, tab) {
  const { sites } = await store.getSettings();
  const parsed = parseTab(tab, sites);
  const signedIn = parsed ? await store.isSignedIn() : false;
  const mapping = parsed && signedIn ? ((await store.getMapping(parsed.key)) ?? null) : null;
  const { episode } = pickEpisode(parsed, mapping?.numEpisodes ?? 0);
  const text = badgeText({ signedIn, parsed, mapping, episode });
  await setBadge(tabId, text);
}

async function refreshActiveBadge() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.url) await updateBadge(tab.id, tab);
}

browser.tabs.onUpdated.addListener(
  async (tabId, changeInfo, tab) => {
    if (!tab?.url) return;
    try {
      const { sites } = await store.getSettings();
      const parsed = parseTab(tab, sites);
      const trigger = visitTrigger(parsed, changeInfo);
      // Pages with no episode source are only matched when the popup opens.
      if (trigger && parsed.source !== "none") {
        await tracker.handleVisit(parsed, trigger, { tabId, windowId: tab.windowId });
      }
    } catch (e) {
      console.error("NextEp:", e);
    }
    await updateBadge(tabId, tab).catch(() => {});
  },
  { properties: ["url", "title", "status"] },
);

const MATCH_FIELDS = "media_type,num_episodes,start_season";

const handlers = {
  async getState({ url, title }) {
    const settings = await store.getSettings();
    const { sites } = settings;
    const parsed = parseTab({ url, title }, sites);
    const hasRule = hostHasRule(url, sites);
    const page = toHttpUrl(url);
    const sample = await store.getTeach();
    const signedIn = await store.isSignedIn();
    const state = {
      signedIn,
      hasClientId: Boolean(resolveClient(settings).clientId),
      parsed,
      generic: parsed || hasRule ? null : detectGeneric(url),
      hostHasRule: hasRule,
      teach: page && sample?.host === siteHost(page) ? sample : null,
      mapping: null,
      anime: null,
    };
    // The page may have been opened while signed out, so no mapping exists yet.
    if (signedIn && parsed) {
      try {
        await tracker.ensureMapping(parsed.key, parsed.slug, parsed.titleName);
      } catch (e) {
        state.apiError = e.message;
      }
    }
    const read = async () => (parsed ? ((await store.getMapping(parsed.key)) ?? null) : null);
    let mapping = await read();
    if (signedIn && mapping?.malId) {
      try {
        const node = await api.details(mapping.malId, "num_episodes,my_list_status");
        state.anime = {
          numEpisodes: node.num_episodes ?? 0,
          listStatus: node.my_list_status ?? null,
        };
        // Keeps the badge and the paused flag in step with what MyAnimeList says.
        if (mapping.confirmed) {
          await tracker.noteListStatus(parsed.key, state.anime.listStatus);
          mapping = await read();
        }
      } catch (e) {
        state.apiError ??= e.message;
      }
    }
    state.mapping = mapping;
    return state;
  },

  async setWatched({ key, episodes, force }) {
    if (!Number.isInteger(episodes)) throw new Error("Episode count must be a whole number.");
    const mapping = await store.getMapping(key);
    if (!mapping?.malId) throw new Error("No anime selected for this show.");
    // The popup shows the result.
    const result = await tracker.applyProgress(mapping.malId, episodes, {
      force: force === true,
      silent: true,
      key,
    });
    return { result };
  },

  async setStatus({ key, status }) {
    if (!LIST_STATUSES.includes(status)) throw new Error("That isn't a list status.");
    // The popup shows the result.
    return { result: await tracker.setStatus(key, status) };
  },

  async removeFromList({ key }) {
    // The popup shows the result.
    await tracker.removeFromList(key);
    return {};
  },

  async resume({ key, episode }) {
    if (episode != null && !Number.isInteger(episode)) {
      throw new Error("Episode must be a whole number.");
    }
    return { result: await tracker.resume(key, episode ?? null) };
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

  async teachStart({ url, title }) {
    const page = toHttpUrl(url);
    if (!page) throw new Error("This only works on http or https pages.");
    await store.setTeach({ host: siteHost(page), url, title: String(title ?? ""), at: Date.now() });
    return {};
  },

  async teachFinish({ url, title }) {
    const first = await store.getTeach();
    if (!first) throw new Error("Open episode 1 first and click \"This is episode 1\".");
    const learned = learnRule(first, { url, title: String(title ?? "") });
    // On failure the first page stays, so the user can try another second page.
    if (!learned.ok) throw new Error(learned.error);
    const settings = await store.getSettings();
    const sites = [
      ...settings.sites.filter((r) => normalizeHost(r.host) !== learned.rule.host),
      learned.rule,
    ];
    await store.saveSettings({ ...settings, sites });
    await store.clearTeach();
    // Record this page too, so the next episode counts as a step from it.
    const parsed = parseTab({ url, title }, sites);
    if (parsed) {
      try {
        await tracker.handleVisit(parsed, "title");
      } catch (e) {
        console.error("NextEp:", e);
      }
    }
    return { rule: learned.rule, episodeFrom: learned.episodeFrom };
  },

  async teachCancel() {
    await store.clearTeach();
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

  async getAccount() {
    const signedIn = await store.isSignedIn();
    return { signedIn, name: signedIn ? await auth.getUserName() : null };
  },

  async takeJustRecorded() {
    return { recorded: await store.takeJustRecorded() };
  },

  async getSettings() {
    return {
      settings: await store.getSettings(),
      hasBuiltInClientId: Boolean(BUILT_IN_CLIENT_ID),
    };
  },

  async saveSettings({ settings }) {
    const sites = (settings.sites ?? []).map((r) => {
      const host = String(r.host ?? "").trim().toLowerCase();
      if (r.url === undefined) return { host, pattern: String(r.pattern ?? "").trim() };
      const rule = {
        host,
        url: String(r.url ?? "").trim(),
        episodeFrom: String(r.episodeFrom ?? ""),
      };
      const title = String(r.title ?? "").trim();
      if (title) rule.title = title;
      return rule;
    });
    const problem = validateRules(sites);
    if (problem) throw new Error(problem);
    const previous = await store.getSettings();
    const next = {
      clientId: String(settings.clientId ?? "").trim(),
      clientSecret: String(settings.clientSecret ?? "").trim(),
      openOnRecord: settings.openOnRecord !== false,
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

const mutating = new Set(["selectMapping", "setWatched", "setStatus", "removeFromList", "resume", "enableSite", "teachFinish", "signIn", "signOut", "saveSettings"]);

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
