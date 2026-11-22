import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/lib/store.js";
import { createTracker } from "../src/lib/tracker.js";
import { truncateQuery } from "../src/lib/title-match.js";
import { parseTab } from "../src/lib/url-parser.js";

// Async hops make interleaving visible if handleVisit were not serialized.
function memoryArea(initial = {}) {
  const data = { ...initial };
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    async get(key) {
      await tick();
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      await tick();
      Object.assign(data, structuredClone(obj));
    },
    async remove(key) {
      delete data[key];
    },
  };
}

const JJK = "jujutsu-kaisen-2nd-season-78067";
const visit = (slug, episode, host = "example.tv", titleName = null) => ({
  host,
  slug,
  episode,
  key: `${host}|${slug}`,
  titleName,
  urlEpisode: episode,
  titleEpisode: null,
  hasTitleTemplate: false,
  source: episode === null ? "none" : "url",
});

// searchResults: {query -> nodes}; anime: {id -> {title, num_episodes, my_list_status}}.
// details returns a fixed snapshot (PATCH does not mutate it) so duplicate PATCHes are visible.
function setup({ searchResults = {}, anime = {}, signedIn = true } = {}) {
  const area = memoryArea(
    signedIn ? { auth: { accessToken: "t", refreshToken: "r", expiresAt: 1 } } : {},
  );
  const store = createStore(area);
  const patches = [];
  const searches = [];
  const notes = [];
  const api = {
    async search(q) {
      searches.push(q);
      const r = searchResults[q] ?? [];
      if (r instanceof Error) throw r;
      return r;
    },
    async details(id, fields) {
      return { id, ...anime[id] };
    },
    async updateStatus(id, body) {
      patches.push({ id, body });
      return body;
    },
  };
  const tracker = createTracker({ store, api, notify: async (m) => notes.push(m), now: () => 42 });
  return { store, tracker, patches, searches, notes };
}

const jjkEnv = (listStatus) =>
  setup({
    searchResults: {
      "jujutsu kaisen 2nd season": [{ id: 51009, title: "Jujutsu Kaisen 2nd Season", num_episodes: 23 }],
    },
    anime: { 51009: { title: "Jujutsu Kaisen 2nd Season", num_episodes: 23, my_list_status: listStatus } },
  });

test("ep-4 then ep-5 -> exactly one PATCH with watched=4", async () => {
  const { tracker, patches } = jjkEnv();
  await tracker.handleVisit(visit(JJK, 4));
  await tracker.handleVisit(visit(JJK, 5));
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], {
    id: 51009,
    body: { num_watched_episodes: 4, status: "watching" },
  });
});

test("same episode seen twice -> still one PATCH", async () => {
  const { tracker, patches } = jjkEnv();
  await tracker.handleVisit(visit(JJK, 4));
  await tracker.handleVisit(visit(JJK, 5));
  await tracker.handleVisit(visit(JJK, 5));
  assert.equal(patches.length, 1);
});

test("jump forward and backwards do nothing", async () => {
  const jump = jjkEnv();
  await jump.tracker.handleVisit(visit(JJK, 4));
  await jump.tracker.handleVisit(visit(JJK, 6));
  assert.equal(jump.patches.length, 0);

  const back = jjkEnv();
  await back.tracker.handleVisit(visit(JJK, 5));
  await back.tracker.handleVisit(visit(JJK, 4));
  assert.equal(back.patches.length, 0);
});

test("MAL already ahead -> no PATCH", async () => {
  const { tracker, patches } = jjkEnv({ status: "watching", num_episodes_watched: 10 });
  await tracker.handleVisit(visit(JJK, 4));
  await tracker.handleVisit(visit(JJK, 5));
  assert.equal(patches.length, 0);
});

test("unconfirmed mapping stores pendingEpisode; selectMapping applies it", async () => {
  const { tracker, store, patches, notes } = setup({
    searchResults: {
      "foo bar": [
        { id: 1, title: "Foo Bar Special", media_type: "special", num_episodes: 1 },
        { id: 2, title: "Foo Bar Returns", media_type: "tv", num_episodes: 12 },
      ],
    },
    anime: { 2: { title: "Foo Bar Returns", num_episodes: 12 } },
  });
  await tracker.handleVisit(visit("foo-bar", 4));
  await tracker.handleVisit(visit("foo-bar", 5));
  assert.equal(patches.length, 0);
  const mapping = await store.getMapping("example.tv|foo-bar");
  assert.equal(mapping.confirmed, false);
  assert.equal(mapping.pendingEpisode, 4);
  assert.equal(mapping.candidates.length, 2);
  assert.ok(notes.some((n) => n.startsWith("Not sure")));

  await tracker.selectMapping("example.tv|foo-bar", 2);
  assert.deepEqual(patches, [{ id: 2, body: { num_watched_episodes: 4, status: "watching" } }]);
  const after = await store.getMapping("example.tv|foo-bar");
  assert.equal(after.confirmed, true);
  assert.deepEqual(after.candidates, []);
  assert.equal(after.pendingEpisode, undefined);
});

test("nothing found -> malId null mapping", async () => {
  const { tracker, store } = setup();
  await tracker.handleVisit(visit("zzz-qqq", 1));
  assert.deepEqual(await store.getMapping("example.tv|zzz-qqq"), {
    malId: null,
    title: undefined,
    numEpisodes: 0,
    confirmed: false,
    candidates: [],
  });
});

test("not signed in -> no API calls but lastSeen is written", async () => {
  const { tracker, store, searches, patches } = setup({ signedIn: false });
  await tracker.handleVisit(visit(JJK, 4));
  assert.deepEqual(searches, []);
  assert.deepEqual(patches, []);
  assert.deepEqual(await store.getLastSeen(`example.tv|${JJK}`), { episode: 4, at: 42 });
});

test("resolution: stripped-ID query for the jujutsu slug", async () => {
  const { tracker, store, searches } = jjkEnv();
  await tracker.handleVisit(visit(JJK, 1));
  assert.deepEqual(searches, ["jujutsu kaisen 2nd season 78067", "jujutsu kaisen 2nd season"]);
  const m = await store.getMapping(`example.tv|${JJK}`);
  assert.equal(m.malId, 51009);
  assert.equal(m.confirmed, true);
});

test("resolution: full query wins for a trailing-year slug", async () => {
  const both = [
    { id: 1, title: "Hunter x Hunter" },
    { id: 2, title: "Hunter x Hunter (2011)" },
  ];
  const { tracker, store, searches } = setup({
    searchResults: { "hunter x hunter 2011": both, "hunter x hunter": both },
  });
  await tracker.handleVisit(visit("hunter-x-hunter-2011", 1));
  assert.deepEqual(searches, ["hunter x hunter 2011"]);
  assert.equal((await store.getMapping("example.tv|hunter-x-hunter-2011")).malId, 2);
});

test("concurrent visits are serialized", async () => {
  const { tracker, patches } = jjkEnv();
  await tracker.handleVisit(visit(JJK, 4));
  await Promise.all([tracker.handleVisit(visit(JJK, 5)), tracker.handleVisit(visit(JJK, 5))]);
  assert.equal(patches.length, 1);
});

test("an error in one visit does not break the queue", async () => {
  const { tracker, store } = setup();
  const original = store.getLastSeen;
  let first = true;
  store.getLastSeen = async (k) => {
    if (first) {
      first = false;
      throw new Error("boom");
    }
    return original(k);
  };
  await assert.rejects(tracker.handleVisit(visit("a-b", 1)), /boom/);
  await tracker.handleVisit(visit("a-b", 2));
  assert.deepEqual(await store.getLastSeen("example.tv|a-b"), { episode: 2, at: 42 });
});

const fooBar = () =>
  setup({
    searchResults: {
      "foo bar": [
        { id: 1, title: "Foo Bar Special", num_episodes: 1 },
        { id: 2, title: "Foo Bar Returns", num_episodes: 12 },
      ],
    },
    anime: { 2: { title: "Foo Bar Returns", num_episodes: 12 } },
  });

test("ensureMapping resolves when missing and is a no-op when present", async () => {
  const { tracker, store, searches } = jjkEnv();
  await tracker.ensureMapping(`example.tv|${JJK}`, JJK);
  assert.equal((await store.getMapping(`example.tv|${JJK}`)).malId, 51009);
  const before = searches.length;
  await tracker.ensureMapping(`example.tv|${JJK}`, JJK);
  assert.equal(searches.length, before);
});

test("search rejected with 400 -> unmatched mapping is stored", async () => {
  const err = Object.assign(new Error("bad query"), { status: 400 });
  const { tracker, store } = setup({ searchResults: { ab: err } });
  await tracker.handleVisit(visit("ab", 1));
  assert.deepEqual(await store.getMapping("example.tv|ab"), {
    malId: null,
    title: undefined,
    numEpisodes: 0,
    confirmed: false,
    candidates: [],
  });
});

test("search network error rejects and stores no mapping", async () => {
  const { tracker, store } = setup({ searchResults: { "foo bar": new TypeError("network") } });
  await assert.rejects(tracker.handleVisit(visit("foo-bar", 1)), /network/);
  assert.equal(await store.getMapping("example.tv|foo-bar"), undefined);
});

test("search 500 also propagates without storing a mapping", async () => {
  const err = Object.assign(new Error("server"), { status: 500 });
  const { tracker, store } = setup({ searchResults: { "foo bar": err } });
  await assert.rejects(tracker.ensureMapping("example.tv|foo-bar", "foo-bar"), /server/);
  assert.equal(await store.getMapping("example.tv|foo-bar"), undefined);
});

test("silent applyProgress still PATCHes but does not notify", async () => {
  const { tracker, patches, notes } = jjkEnv();
  const res = await tracker.applyProgress(51009, 3, { force: true, silent: true });
  assert.equal(res.updated, true);
  assert.equal(patches.length, 1);
  assert.deepEqual(notes, []);
});

test("non-silent applyProgress notifies", async () => {
  const { tracker, notes } = jjkEnv();
  await tracker.applyProgress(51009, 3);
  assert.deepEqual(notes, ["Jujutsu Kaisen 2nd Season: watched 3/23"]);
});

test("a queued selectMapping waits for an in-flight handleVisit and nothing deadlocks", async () => {
  const { tracker, store, patches } = fooBar();
  await tracker.handleVisit(visit("foo-bar", 4));
  const writes = [];
  const setMapping = store.setMapping;
  store.setMapping = (k, m) => {
    writes.push(m.confirmed);
    return setMapping(k, m);
  };
  const inFlight = tracker.handleVisit(visit("foo-bar", 5));
  const selected = tracker.selectMapping("example.tv|foo-bar", 2);
  await Promise.all([inFlight, selected]);
  // Visit stores pendingEpisode (unconfirmed) first; only then does select confirm.
  assert.deepEqual(writes, [false, true]);
  assert.deepEqual(patches, [{ id: 2, body: { num_watched_episodes: 4, status: "watching" } }]);
  assert.equal((await store.getMapping("example.tv|foo-bar")).confirmed, true);
});

test("the tab title name is searched first and accepted on one exact match", async () => {
  const { tracker, store, searches } = setup({
    searchResults: {
      "Some Show": [{ id: 7, title: "Some Show", num_episodes: 12 }],
    },
  });
  await tracker.handleVisit(visit("some-show-9285", 1, "example.tv", "Some Show"));
  assert.deepEqual(searches, ["Some Show"]);
  const m = await store.getMapping("example.tv|some-show-9285");
  assert.equal(m.malId, 7);
  assert.equal(m.confirmed, true);
});

test("a long title is searched cut short but matched against the full text", async () => {
  const full = "The Very Long Anime Title That Goes On And On And On For Quite A While Indeed";
  assert.ok(full.length > 64);
  const { tracker, store, searches } = setup({
    searchResults: { [truncateQuery(full)]: [{ id: 5, title: full, num_episodes: 12 }] },
  });
  await tracker.handleVisit(visit("long-show", 1, "example.tv", full));
  assert.deepEqual(searches, [truncateQuery(full)]);
  const m = await store.getMapping("example.tv|long-show");
  assert.equal(m.malId, 5);
  assert.equal(m.confirmed, true);
});

test("the shorter slug guess only fills suggestions and is never accepted", async () => {
  const { tracker, store, searches, notes } = setup({
    searchResults: {
      "jujutsu kaisen 2nd": [{ id: 3, title: "Jujutsu Kaisen 2nd", num_episodes: 12 }],
    },
  });
  await tracker.handleVisit(visit(JJK, 1));
  assert.deepEqual(searches, [
    "jujutsu kaisen 2nd season 78067",
    "jujutsu kaisen 2nd season",
    "jujutsu kaisen 2nd",
  ]);
  const m = await store.getMapping(`example.tv|${JJK}`);
  assert.equal(m.confirmed, false);
  assert.equal(m.malId, 3);
  assert.deepEqual(m.candidates.map((c) => c.id), [3]);
  assert.ok(notes.some((n) => n.startsWith("Not sure")));
});

test("two exact matches from an auto candidate are not accepted", async () => {
  const { tracker, store } = setup({
    searchResults: {
      "foo bar": [
        { id: 1, title: "Foo Bar" },
        { id: 2, title: "X", alternative_titles: { synonyms: ["Foo Bar"] } },
      ],
    },
  });
  await tracker.handleVisit(visit("foo-bar", 1));
  const m = await store.getMapping("example.tv|foo-bar");
  assert.equal(m.confirmed, false);
  assert.equal(m.candidates.length, 2);
});

test("a visit with no episode only makes sure a mapping exists", async () => {
  const { tracker, store, patches } = jjkEnv();
  await tracker.handleVisit(visit(JJK, null));
  assert.equal((await store.getMapping(`example.tv|${JJK}`)).malId, 51009);
  assert.equal(await store.getLastSeen(`example.tv|${JJK}`), undefined);
  assert.deepEqual(patches, []);
});

test("a visit with no episode does nothing when signed out", async () => {
  const { tracker, store, searches } = setup({ signedIn: false });
  await tracker.handleVisit(visit(JJK, null));
  assert.deepEqual(searches, []);
  assert.equal(await store.getMapping(`example.tv|${JJK}`), undefined);
});

test("a no-episode visit between two episodes does not break the step", async () => {
  const { tracker, patches } = jjkEnv();
  await tracker.handleVisit(visit(JJK, 4));
  await tracker.handleVisit(visit(JJK, null));
  await tracker.handleVisit(visit(JJK, 5));
  assert.equal(patches.length, 1);
});

// Parsed tabs for a rule, as the background page would hand them over.
const tab = (rule, url, title) => parseTab({ url, title }, [rule]);

test("an internal ID in the address loses to the title, one PATCH at the end", async () => {
  const rule = {
    host: "h.example",
    url: "/watch/{show}?ep={episode}",
    title: "{show} Episode {episode}{anything}",
    episodeFrom: "url",
  };
  const base = "https://h.example/watch/tokyo-revengers-10486";
  const { tracker, patches, store } = setup({
    searchResults: {
      "Tokyo Revengers": [{ id: 9, title: "Tokyo Revengers", num_episodes: 13 }],
    },
    anime: { 9: { title: "Tokyo Revengers", num_episodes: 13 } },
  });
  const key = "h.example|tokyo-revengers-10486";
  const one = tab(rule, base + "?ep=149945", "Tokyo Revengers Episode 1 | SiteH");
  await tracker.handleVisit(one, "title");
  assert.deepEqual(await store.getLastSeen(key), { episode: 1, at: 42 });

  // The address changed but the title is still the old page's.
  const stale = tab(rule, base + "?ep=150093", "Tokyo Revengers Episode 1 | SiteH");
  await tracker.handleVisit(stale, "url");
  assert.deepEqual(patches, []);

  const two = tab(rule, base + "?ep=150093", "Tokyo Revengers Episode 2 | SiteH");
  await tracker.handleVisit(two, "title");
  assert.deepEqual(patches, [{ id: 9, body: { num_watched_episodes: 1, status: "watching" } }]);
  assert.equal((await store.getLastSeen(key)).episode, 2);
});

test("an impossible address number with no title number records nothing", async () => {
  const rule = {
    host: "h.example",
    url: "/watch/{show}?ep={episode}",
    title: "{show} Episode {episode}{anything}",
    episodeFrom: "url",
  };
  const key = "h.example|tokyo-revengers-10486";
  const { tracker, patches, store } = setup();
  await store.setMapping(key, {
    malId: 9,
    title: "Tokyo Revengers",
    numEpisodes: 13,
    confirmed: true,
    candidates: [],
  });
  const parsed = tab(rule, "https://h.example/watch/tokyo-revengers-10486?ep=149945", "Loading");
  assert.equal(parsed.urlEpisode, 149945);
  assert.equal(parsed.titleEpisode, null);
  await tracker.handleVisit(parsed, "title");
  assert.equal(await store.getLastSeen(key), undefined);
  assert.deepEqual(patches, []);
});

test("the address wins over a stale title when its number can be an episode", async () => {
  const rule = {
    host: "example.tv",
    url: "/watch/{show}/ep-{episode}",
    title: "{show} Episode {episode}{anything}",
    episodeFrom: "url",
  };
  const { tracker, store, patches } = jjkEnv();
  const parsed = tab(
    rule,
    `https://example.tv/watch/${JJK}/ep-5`,
    "Jujutsu Kaisen 2nd Season Episode 4 English SUB",
  );
  assert.equal(parsed.urlEpisode, 5);
  assert.equal(parsed.titleEpisode, 4);
  await tracker.handleVisit(tab(rule, `https://example.tv/watch/${JJK}/ep-4`, "x"), "url");
  await tracker.handleVisit(parsed, "url");
  assert.equal((await store.getLastSeen(`example.tv|${JJK}`)).episode, 5);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.num_watched_episodes, 4);
});

test("with a title template, an address change waits for the title to name the show", async () => {
  const rule = {
    host: "i.example",
    url: "/anime/watch?id={show}&ep={episode}",
    title: "Episode {episode} {show}",
    episodeFrom: "url",
  };
  const url = "https://i.example/anime/watch?id=14&src=a&ep=2&lang=hindi&svr=igris";
  const { tracker, store, searches } = setup({
    searchResults: {
      "Dragon Ball Super": [{ id: 30, title: "Dragon Ball Super", num_episodes: 131 }],
    },
  });
  const early = tab(rule, url, "Watch Episode 1 of Anime - SiteI");
  await tracker.handleVisit(early, "url");
  assert.deepEqual(searches, []);
  assert.equal(await store.getMapping("i.example|14"), undefined);
  assert.equal((await store.getLastSeen("i.example|14")).episode, 2);

  const later = tab(rule, url, "Episode 2 - Dragon Ball Super");
  await tracker.handleVisit(later, "title");
  assert.deepEqual(searches, ["Dragon Ball Super"]);
  assert.equal((await store.getMapping("i.example|14")).malId, 30);
});

test("a step from the address resolves the mapping from the slug without waiting", async () => {
  const rule = {
    host: "example.tv",
    url: "/watch/{show}/ep-{episode}",
    title: "{show} Episode {episode}{anything}",
    episodeFrom: "url",
  };
  const { tracker, searches, patches } = jjkEnv();
  await tracker.handleVisit(tab(rule, `https://example.tv/watch/${JJK}/ep-1`, "x"), "url");
  assert.deepEqual(searches, []);
  await tracker.handleVisit(tab(rule, `https://example.tv/watch/${JJK}/ep-2`, "x"), "url");
  assert.ok(searches.includes("jujutsu kaisen 2nd season"));
  assert.equal(patches.length, 1);
});

test("a title name that shares no word with the slug is not used", async () => {
  const { tracker, searches } = setup();
  await tracker.handleVisit(visit("one-piece-21", 1, "example.tv", "Attack on Titan"), "title");
  assert.deepEqual(searches, ["one piece 21", "one piece", "one"]);
});

test("a title name only counts on a title trigger", async () => {
  const { tracker, searches } = setup();
  await tracker.handleVisit(visit("one-piece-21", 1, "example.tv", "One Piece"), "url");
  assert.equal(searches[0], "one piece 21");
});

test("suggestions come from the last auto candidate with results, not the shorter guess", async () => {
  const { tracker, store, searches } = setup({
    searchResults: {
      "foo bar 99": [{ id: 1, title: "Foo Bar Movie", num_episodes: 1 }],
      "foo bar": [{ id: 2, title: "Foo Bar Returns", num_episodes: 12 }],
      foo: [{ id: 3, title: "Foo Only", num_episodes: 3 }],
    },
  });
  await tracker.handleVisit(visit("foo-bar-99", 1));
  assert.deepEqual(searches, ["foo bar 99", "foo bar"]);
  const m = await store.getMapping("example.tv|foo-bar-99");
  assert.equal(m.confirmed, false);
  assert.deepEqual(m.candidates.map((c) => c.id), [2]);
});
