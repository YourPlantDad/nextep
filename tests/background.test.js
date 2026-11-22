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
    settings: { clientId: "", clientSecret: "", openOnRecord: true, sites, ...settings },
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
  assert.equal(typeof res.rule.pattern, "undefined");
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
      clientId: "",
      clientSecret: "",
      openOnRecord: true,
      sites: [{ host: HOST, url: "/watch/{show}/ep-{bogus}", episodeFrom: "url" }],
    },
  });
  assert.equal(res.ok, false);
  assert.ok(typeof res.error === "string" && res.error.length > 0);
  assert.deepEqual(env.data.settings, before);
});

test("saveSettings with a valid template stores it", async () => {
  const env = await boot();
  const sites = [{ host: "Example.TV", url: "/v/{show}/{episode}", episodeFrom: "url" }];
  const res = await env.send({ type: "saveSettings", settings: { openOnRecord: false, sites } });
  assert.deepEqual(res, { ok: true, signedOut: false });
  assert.equal(env.data.settings.sites[0].host, "example.tv");
  assert.equal(env.data.settings.openOnRecord, false);
});
