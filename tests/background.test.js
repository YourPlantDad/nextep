import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createBrowser, createMal } from "./helpers/fakes.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN = fileURLToPath(new URL("../src/background/main.js", import.meta.url));

const HOST = "example.tv";
const KEY = `${HOST}|my-show`;
const ADDRESS_RULE = { host: HOST, url: "/watch/{show}/ep-{episode}", episodeFrom: "url" };
const TITLE_RULE = {
  host: HOST,
  url: "/watch/{show}",
  title: "{show} Episode {episode}{anything}",
  episodeFrom: "title",
};
const CROSS_CHECK_RULE = {
  host: HOST,
  url: "/watch/{show}?ep={episode}",
  title: "{show} Episode {episode}{anything}",
  episodeFrom: "url",
};

const watchUrl = (n) => `https://${HOST}/watch/my-show/ep-${n}`;
const settle = () => new Promise((r) => setTimeout(r, 15));

let loads = 0;

// Installs fresh fakes, then loads a fresh copy of main.js.
async function boot({ anime, sites = [ADDRESS_RULE], settings = {}, storage = {}, signedIn = true, tabs, windows } = {}) {
  const base = {
    settings: { openOnRecord: true, sites, ...settings },
    ...(signedIn
      ? { auth: { accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 30 * 24 * 3600 * 1000 } }
      : {}),
    ...storage,
  };
  const fake = createBrowser({ storage: base, tabs, windows });
  const mal = createMal({
    anime: anime ?? [{ id: 1, title: "My Show", num_episodes: 12 }],
  });
  globalThis.browser = fake.browser;
  globalThis.fetch = mal.fetch;
  await import(pathToFileURL(MAIN).href + "?t=" + ++loads);

  const [onMessage] = fake.listeners.onMessage;
  const [updated] = fake.listeners.onUpdated;
  return {
    ...fake,
    mal,
    send: (message) => onMessage(message),
    tabEvent: async (tabId, changeInfo, tab) => {
      await updated.fn(tabId, changeInfo, tab);
      await settle();
    },
    lastBadge: (tabId) => fake.calls.badgeText.filter((c) => c.tabId === tabId).at(-1)?.text,
  };
}

const page = (url, title = "", extra = {}) => ({ id: 1, windowId: 1, active: true, url, title, ...extra });

test("loading registers one tab listener with a filter and one message listener", async () => {
  const env = await boot();
  assert.equal(env.listeners.onUpdated.length, 1);
  assert.equal(env.listeners.onMessage.length, 1);
  const { properties } = env.listeners.onUpdated[0].filter;
  for (const p of ["url", "title", "status"]) assert.ok(properties.includes(p), p);
});

test("an unknown message type returns an error and does not throw", async () => {
  const env = await boot();
  const res = await env.send({ type: "noSuchThing" });
  assert.equal(res.ok, false);
  assert.match(res.error, /Unknown message type: noSuchThing/);
  assert.equal((await env.send(undefined)).ok, false);
});

test("every message type sent by the popup and settings page has a handler", async () => {
  const types = new Set();
  for (const file of ["src/popup/popup.js", "src/options/options.js"]) {
    const text = readFileSync(ROOT + file, "utf8");
    for (const m of text.matchAll(/send\(\s*\{\s*type:\s*"(\w+)"/g)) types.add(m[1]);
  }
  assert.ok(types.size >= 15, `found only ${types.size} message types`);
  const env = await boot();
  for (const type of types) {
    const res = await env.send({ type });
    assert.ok(!/Unknown message type/.test(res.error ?? ""), `no handler for ${type}`);
  }
});

test("address rule: episode 4 then episode 5 records one update of 4 and shows the check mark", async () => {
  const env = await boot();
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  assert.equal(env.mal.patches().length, 0);
  await env.tabEvent(1, { url: watchUrl(5) }, page(watchUrl(5)));
  const patches = env.mal.patches();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].path, "/v2/anime/1/my_list_status");
  assert.equal(patches[0].form.num_watched_episodes, "4");
  assert.equal(env.lastBadge(1), "✓");
  assert.deepEqual(env.mal.model.get(1).list, { status: "watching", num_episodes_watched: 4 });
});

test("title rule: a bare address change records nothing, the title event records the step", async () => {
  const env = await boot({ sites: [TITLE_RULE] });
  const url = `https://${HOST}/watch/my-show`;
  await env.tabEvent(1, { title: "My Show Episode 4" }, page(url, "My Show Episode 4"));
  await env.tabEvent(1, { url }, page(url, "My Show Episode 4"));
  assert.equal(env.mal.patches().length, 0);
  assert.equal(env.data.lastSeen[KEY].episode, 4);

  await env.tabEvent(1, { title: "My Show Episode 5 - ExampleSite" }, page(url, "My Show Episode 5 - ExampleSite"));
  const patches = env.mal.patches();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].form.num_watched_episodes, "4");
});

test("title rule: a stale title from another show is not counted for the new show", async () => {
  const env = await boot({
    sites: [TITLE_RULE],
    anime: [
      { id: 1, title: "Show A", num_episodes: 12 },
      { id: 2, title: "Show B", num_episodes: 12 },
    ],
  });
  const urlA = `https://${HOST}/watch/show-a`;
  const urlB = `https://${HOST}/watch/show-b`;
  const titleA = "Show A Episode 3 | ExampleSite";
  const titleB = "Show B Episode 4 | ExampleSite";
  await env.tabEvent(1, { title: titleA }, page(urlA, titleA));
  assert.equal(env.data.lastSeen[`${HOST}|show-a`].episode, 3);

  // The address changes first, while the tab title is still show A's.
  await env.tabEvent(1, { url: urlB }, page(urlB, titleA));
  assert.equal(env.data.lastSeen[`${HOST}|show-b`], undefined);

  await env.tabEvent(1, { title: titleB }, page(urlB, titleB));
  assert.equal(env.mal.patches().length, 0);
  for (const r of env.mal.requests) {
    assert.ok(!/num_watched_episodes=3/.test(r.body ?? ""), `stale episode sent: ${r.method} ${r.url}`);
  }
  assert.equal(env.data.lastSeen[`${HOST}|show-b`].episode, 4);
});

test("address number that is an internal ID is ignored in favour of the title number", async () => {
  const env = await boot({
    sites: [CROSS_CHECK_RULE],
    anime: [{ id: 1, title: "My Show", num_episodes: 13 }],
  });
  const at = (id) => `https://${HOST}/watch/my-show?ep=${id}`;
  const t1 = "My Show Episode 1";
  const t2 = "My Show Episode 2";
  await env.tabEvent(1, { url: at(149945) }, page(at(149945), ""));
  await env.tabEvent(1, { title: t1 }, page(at(149945), t1));
  await env.tabEvent(1, { url: at(149946) }, page(at(149946), t1));
  await env.tabEvent(1, { title: t2 }, page(at(149946), t2));

  const patches = env.mal.patches();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].form.num_watched_episodes, "1");
  for (const r of env.mal.requests) {
    assert.ok(!`${r.url} ${r.body}`.includes("149945"), `request carries the id: ${r.method} ${r.url}`);
  }
});

test("on-hold anime: a step is not sent, state shows paused, resume sets watching", async () => {
  const env = await boot({
    anime: [{ id: 1, title: "My Show", num_episodes: 12, list: { status: "on_hold", num_episodes_watched: 2 } }],
  });
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  await env.tabEvent(1, { url: watchUrl(5) }, page(watchUrl(5)));
  assert.equal(env.mal.patches().length, 0);

  const state = await env.send({ type: "getState", url: watchUrl(5), title: "" });
  assert.equal(state.ok, true);
  assert.equal(state.mapping.paused, "on_hold");

  const res = await env.send({ type: "resume", key: KEY });
  assert.equal(res.ok, true);
  const patches = env.mal.patches();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].form.status, "watching");
  assert.equal(patches[0].form.num_watched_episodes, "4");
});

test("teach flow with an episode 1 page and an episode 2 page stores a new-style rule", async () => {
  const env = await boot({ sites: [] });
  const one = { url: `https://${HOST}/watch/my-show/episode-1`, title: "My Show Episode 1" };
  const two = { url: `https://${HOST}/watch/my-show/episode-2`, title: "My Show Episode 2" };
  assert.equal((await env.send({ type: "teachStart", ...one })).ok, true);
  assert.equal(env.data.teach.host, HOST);

  const res = await env.send({ type: "teachFinish", ...two });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.episodeFrom, "url");
  assert.equal(res.rule.host, HOST);
  assert.equal(res.rule.url, "/watch/{show}/episode-{episode}");
  assert.deepEqual(env.data.settings.sites, [res.rule]);
  assert.equal(env.data.teach, undefined);
});

test("setStatus completed sends status and total; removeFromList deletes and state shows not listed", async () => {
  const env = await boot({
    anime: [{ id: 1, title: "My Show", num_episodes: 12, list: { status: "watching", num_episodes_watched: 3 } }],
    storage: {
      mappings: { [KEY]: { malId: 1, title: "My Show", numEpisodes: 12, confirmed: true, candidates: [] } },
    },
  });
  const done = await env.send({ type: "setStatus", key: KEY, status: "completed" });
  assert.equal(done.ok, true);
  const [patch] = env.mal.patches();
  assert.equal(patch.form.status, "completed");
  assert.equal(patch.form.num_watched_episodes, "12");

  const removed = await env.send({ type: "removeFromList", key: KEY });
  assert.equal(removed.ok, true);
  assert.equal(env.mal.requests.filter((r) => r.method === "DELETE").length, 1);
  const state = await env.send({ type: "getState", url: watchUrl(3), title: "" });
  assert.equal(state.anime.listStatus, null);
  assert.equal(state.mapping.listStatus, null);
});

test("a recorded step opens the popup for an active tab in a focused window", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ tabs: [tab], windows: [{ id: 1, focused: true }] });
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  await env.tabEvent(1, { url: watchUrl(5) }, tab);
  assert.equal(env.mal.patches().length, 1);
  assert.deepEqual(env.calls.openPopup, [{ windowId: 1 }]);
  assert.equal(env.data.justRecorded.count, 4);
});

test("a recorded step does not open the popup when the setting is off", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ settings: { openOnRecord: false }, tabs: [tab], windows: [{ id: 1, focused: true }] });
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  await env.tabEvent(1, { url: watchUrl(5) }, tab);
  assert.equal(env.mal.patches().length, 1);
  assert.equal(env.calls.openPopup.length, 0);
});

test("a recorded step does not open the popup for an unfocused window", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ tabs: [tab], windows: [{ id: 1, focused: false }] });
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  await env.tabEvent(1, { url: watchUrl(5) }, tab);
  assert.equal(env.mal.patches().length, 1);
  assert.equal(env.calls.openPopup.length, 0);
});

test("saveSettings with a broken template fails and leaves stored settings unchanged", async () => {
  const env = await boot();
  const before = structuredClone(env.data.settings);
  const res = await env.send({
    type: "saveSettings",
    settings: {
      openOnRecord: true,
      sites: [{ host: HOST, url: "/watch/{show}/ep-{bogus}", episodeFrom: "url" }],
    },
  });
  assert.equal(res.ok, false);
  assert.ok(typeof res.error === "string" && res.error.length > 0);
  assert.deepEqual(env.data.settings, before);
});

test("saveSettings with a broken second rule reports its index and stores nothing", async () => {
  const env = await boot();
  const before = structuredClone(env.data.settings);
  const sites = [
    { host: "example.tv", url: "/v/{show}/{episode}", episodeFrom: "url" },
    { host: "", url: "/v/{show}/{episode}", episodeFrom: "url" },
  ];
  const res = await env.send({ type: "saveSettings", settings: { sites } });
  assert.equal(res.ok, false);
  assert.equal(res.index, 1);
  assert.equal(res.error, "Fill in the website for this entry, or remove it.");
  assert.deepEqual(env.data.settings, before);
});

test("saveSettings with a valid template stores it", async () => {
  const env = await boot();
  const sites = [{ host: "Example.TV", url: "/v/{show}/{episode}", episodeFrom: "url" }];
  const res = await env.send({ type: "saveSettings", settings: { openOnRecord: false, sites } });
  assert.deepEqual(res, { ok: true });
  assert.equal(env.data.settings.sites[0].host, "example.tv");
  assert.equal(env.data.settings.openOnRecord, false);
});

const CONFIRMED = { malId: 1, title: "My Show", numEpisodes: 12, confirmed: true, candidates: [] };
const seedMapping = (extra = {}) => ({ mappings: { [KEY]: { ...CONFIRMED, ...extra } } });
const listed = (n, status = "watching") => ({
  id: 1,
  title: "My Show",
  num_episodes: 12,
  list: { status, num_episodes_watched: n },
});
const stepTo5 = async (env, tab) => {
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  await env.tabEvent(1, { url: watchUrl(5) }, tab);
};

test("a failed update keeps the step, so the next event for the page records it", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ tabs: [tab], settings: { openOnRecord: false } });
  await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  env.mal.failNext("PATCH", /my_list_status$/, 500);
  const log = console.error;
  console.error = () => {};
  try {
    await env.tabEvent(1, { url: watchUrl(5) }, tab);
  } finally {
    console.error = log;
  }
  assert.equal(env.mal.model.get(1).list, undefined);
  assert.equal(env.data.lastSeen[KEY].episode, 4);

  await env.tabEvent(1, { status: "complete" }, tab);
  assert.deepEqual(env.mal.model.get(1).list, { status: "watching", num_episodes_watched: 4 });
  assert.equal(env.data.lastSeen[KEY].episode, 5);
});

test("a failed first visit leaves no last-seen entry behind", async () => {
  const env = await boot();
  env.mal.failNext("GET", /\/v2\/anime$/, 500);
  const log = console.error;
  console.error = () => {};
  try {
    await env.tabEvent(1, { url: watchUrl(4) }, page(watchUrl(4)));
  } finally {
    console.error = log;
  }
  assert.equal(env.data.lastSeen?.[KEY], undefined);
});

test("getState refreshes the badge of the active tab", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ tabs: [tab], anime: [listed(2, "on_hold")], storage: seedMapping() });
  assert.equal(env.calls.badgeText.length, 0);
  const state = await env.send({ type: "getState", url: watchUrl(5), title: "" });
  assert.equal(state.mapping.paused, "on_hold");
  assert.equal(env.lastBadge(1), "II");
});

const other = () => page("https://other.example.test/", "", { id: 1 });
const background = () => page(watchUrl(5), "", { id: 2, active: false });

test("signOut refreshes the badge of a tab that is not active", async () => {
  const env = await boot({ tabs: [other(), background()], storage: seedMapping() });
  assert.equal((await env.send({ type: "signOut" })).ok, true);
  assert.equal(env.lastBadge(2), "!");
});

test("signIn refreshes the badge of a tab that is not active", async () => {
  const env = await boot({ tabs: [other(), background()], storage: seedMapping(), signedIn: false });
  const res = await env.send({ type: "signIn" });
  assert.equal(res.ok, true, res.error);
  assert.equal(env.lastBadge(2), "");
});

test("saveSettings refreshes the badge of a tab that is not active", async () => {
  const env = await boot({ tabs: [other(), background()], sites: [] });
  assert.equal(env.lastBadge(2), undefined);
  const res = await env.send({ type: "saveSettings", settings: { sites: [ADDRESS_RULE] } });
  assert.equal(res.ok, true, res.error);
  assert.equal(env.lastBadge(2), "?");
});

const handActions = {
  removeFromList: (env) => env.send({ type: "removeFromList", key: KEY }),
  setStatus: (env) => env.send({ type: "setStatus", key: KEY, status: "plan_to_watch" }),
  "a forced setWatched": (env) => env.send({ type: "setWatched", key: KEY, episodes: 2, force: true }),
  resume: (env) => env.send({ type: "resume", key: KEY }),
};
for (const [name, act] of Object.entries(handActions)) {
  test(`the check mark goes away after ${name}`, async () => {
    const tab = page(watchUrl(5));
    const env = await boot({ tabs: [tab], settings: { openOnRecord: false } });
    await stepTo5(env, tab);
    assert.equal(env.lastBadge(1), "✓");
    const res = await act(env);
    assert.equal(res.ok, true, res.error);
    assert.notEqual(env.lastBadge(1), "✓");
    assert.equal(env.data.mappings[KEY].lastRecorded, undefined);
  });
}

test("adjustWatched applies to the current count, not one read earlier", async () => {
  const env = await boot({ anime: [listed(5)], storage: seedMapping() });
  // Another tab records an episode after the popup read 5.
  env.mal.model.get(1).list.num_episodes_watched = 6;
  const res = await env.send({ type: "adjustWatched", key: KEY, delta: -1 });
  assert.equal(res.ok, true, res.error);
  assert.equal(env.mal.patches().length, 1);
  assert.equal(env.mal.patches()[0].form.num_watched_episodes, "5");
  assert.equal(env.mal.model.get(1).list.num_episodes_watched, 5);

  await env.send({ type: "adjustWatched", key: KEY, delta: 1 });
  assert.equal(env.mal.model.get(1).list.num_episodes_watched, 6);
});

test("adjustWatched stays between zero and the total", async () => {
  const low = await boot({ anime: [listed(0)], storage: seedMapping() });
  assert.equal((await low.send({ type: "adjustWatched", key: KEY, delta: -1 })).ok, true);
  assert.equal(low.mal.patches().length, 0);

  const high = await boot({ anime: [listed(12, "completed")], storage: seedMapping() });
  assert.equal((await high.send({ type: "adjustWatched", key: KEY, delta: 1 })).ok, true);
  assert.equal(high.mal.patches().length, 0);
});

test("adjustWatched rejects a change other than 1 or -1", async () => {
  const env = await boot({ anime: [listed(5)], storage: seedMapping() });
  for (const delta of [0, 2, -2, "1", 1.5, null, undefined]) {
    const res = await env.send({ type: "adjustWatched", key: KEY, delta });
    assert.equal(res.ok, false, String(delta));
  }
  assert.equal(env.mal.patches().length, 0);
});

test("saveSettings reduces a website entry to its hostname", async () => {
  const env = await boot();
  for (const host of ["https://Example.tv/watch", "example.tv/", "www.example.tv/watch", "WWW.Example.TV", "localhost"]) {
    const sites = [{ host, url: "/v/{show}/{episode}", episodeFrom: "url" }];
    const res = await env.send({ type: "saveSettings", settings: { sites } });
    assert.equal(res.ok, true, `${host}: ${res.error}`);
    const expected = host === "localhost" ? "localhost" : "example.tv";
    assert.equal(env.data.settings.sites[0].host, expected, host);
  }
});

test("saveSettings rejects a website that can never match", async () => {
  const env = await boot();
  const before = structuredClone(env.data.settings);
  for (const host of ["not a host", "example", "https://"]) {
    const sites = [{ host, url: "/v/{show}/{episode}", episodeFrom: "url" }];
    const res = await env.send({ type: "saveSettings", settings: { sites } });
    assert.equal(res.ok, false, host);
    assert.match(res.error, /: the website should look like example\.tv\.$/);
  }
  assert.deepEqual(env.data.settings, before);
});

test("justRecorded is cleared when the popup can't be opened", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ tabs: [tab], windows: [{ id: 1, focused: true }] });
  env.behavior.openPopupFails = true;
  await stepTo5(env, tab);
  assert.equal(env.mal.patches().length, 1);
  assert.equal(env.calls.openPopup.length, 0);
  assert.equal(env.data.justRecorded, undefined);
  assert.deepEqual(await env.send({ type: "takeJustRecorded" }), { ok: true, recorded: null });
});

test("a rejecting openPopup logs a warning", async () => {
  const tab = page(watchUrl(5));
  const env = await boot({ tabs: [tab], windows: [{ id: 1, focused: true }] });
  env.behavior.openPopupFails = true;
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await stepTo5(env, tab);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^NextEp: didn't open the popup, openPopup failed: openPopup failed/);
});

const CACHED = {
  listStatus: { status: "on_hold", watched: 2 },
  paused: "on_hold",
  pausedEpisode: 4,
  lastRecorded: { pageEpisode: 5, count: 4, at: 1 },
  pendingEpisode: 3,
};

test("signOut strips cached list state and keeps which anime the show is", async () => {
  const env = await boot({ storage: seedMapping(CACHED) });
  assert.equal((await env.send({ type: "signOut" })).ok, true);
  assert.equal(env.data.auth, undefined);
  assert.deepEqual(env.data.mappings[KEY], CONFIRMED);
});

test("an old stored Client ID and secret are ignored and not written back", async () => {
  const env = await boot({ settings: { clientId: "old-id", clientSecret: "old-secret" } });
  const settings = await env.send({ type: "getSettings" });
  assert.deepEqual(Object.keys(settings.settings).sort(), ["openOnRecord", "sites"]);
  const res = await env.send({
    type: "saveSettings",
    settings: { clientId: "other", clientSecret: "other", openOnRecord: true, sites: [ADDRESS_RULE] },
  });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(env.data.settings, { openOnRecord: true, sites: [ADDRESS_RULE] });
  assert.ok(env.data.auth, "still signed in");
});

const OLD_RULE = { host: "old.example.tv", pattern: "^/watch/(?<slug>[^/]+)/ep-(?<ep>[0-9]+)" };

test("on start, stored rules without an address template are removed in one write", async () => {
  const stored = { settings: { openOnRecord: false, sites: [OLD_RULE, ADDRESS_RULE, TITLE_RULE] } };
  const fake = createBrowser({ storage: stored });
  let writes = 0;
  const set = fake.browser.storage.local.set;
  fake.browser.storage.local.set = async (obj) => {
    writes++;
    return set(obj);
  };
  globalThis.browser = fake.browser;
  globalThis.fetch = createMal().fetch;
  await import(pathToFileURL(MAIN).href + "?t=" + ++loads);
  await settle();
  assert.equal(writes, 1);
  assert.deepEqual(fake.data.settings, { openOnRecord: false, sites: [ADDRESS_RULE, TITLE_RULE] });
});

test("on start, nothing is written when every stored rule has an address template", async () => {
  const fake = createBrowser({ storage: { settings: { openOnRecord: true, sites: [ADDRESS_RULE] } } });
  let writes = 0;
  const set = fake.browser.storage.local.set;
  fake.browser.storage.local.set = async (obj) => {
    writes++;
    return set(obj);
  };
  globalThis.browser = fake.browser;
  globalThis.fetch = createMal().fetch;
  await import(pathToFileURL(MAIN).href + "?t=" + ++loads);
  await settle();
  assert.equal(writes, 0);
});

test("on start, removing old rules leaves matches and last-seen entries alone", async () => {
  const oldKey = "old.example.tv|my-show";
  const storage = {
    mappings: { [oldKey]: { ...CONFIRMED } },
    lastSeen: { [oldKey]: { episode: 4, at: 1 } },
  };
  const env = await boot({ sites: [OLD_RULE], storage });
  await settle();
  assert.deepEqual(env.data.settings.sites, []);
  assert.deepEqual(env.data.mappings, storage.mappings);
  assert.deepEqual(env.data.lastSeen, storage.lastSeen);
  // The old rule never shows up as a site that is enabled.
  const state = await env.send({ type: "getState", url: "https://old.example.tv/watch/my-show/ep-5", title: "" });
  assert.equal(state.hostHasRule, false);
  assert.equal(state.parsed, null);
});

test("enableSite stores an address template rule and records the page", async () => {
  const env = await boot({ sites: [] });
  const url = `https://www.${HOST}/watch/my-show-123/ep-4?lang=en`;
  const state = await env.send({ type: "getState", url, title: "" });
  assert.deepEqual(state.generic, {
    host: HOST,
    slug: "my-show-123",
    episode: 4,
    rule: { host: HOST, url: "/watch/{show}/ep-{episode}", episodeFrom: "url" },
  });
  const res = await env.send({ type: "enableSite", url });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(env.data.settings.sites, [{ host: HOST, url: "/watch/{show}/ep-{episode}", episodeFrom: "url" }]);
  assert.equal(env.data.lastSeen[`${HOST}|my-show-123`].episode, 4);
  const bad = await env.send({ type: "enableSite", url: `https://${HOST}/about` });
  assert.equal(bad.ok, false);
});

test("a search that MyAnimeList rejects gets a plain message", async () => {
  const env = await boot();
  env.mal.failNext("GET", /\/v2\/anime$/, 400);
  const res = await env.send({ type: "search", query: "x" });
  assert.deepEqual(res, {
    ok: false,
    error: "MyAnimeList didn't accept that search. Try a longer or different name.",
  });
});

test("other search errors keep their text", async () => {
  const env = await boot();
  env.mal.failNext("GET", /\/v2\/anime$/, 500);
  const res = await env.send({ type: "search", query: "x" });
  assert.equal(res.ok, false);
  assert.match(res.error, /API error 500/);
});
