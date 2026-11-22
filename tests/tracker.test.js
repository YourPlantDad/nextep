import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/lib/store.js";
import { createTracker } from "../src/lib/tracker.js";

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
const visit = (slug, episode, host = "example.tv") => ({
  host,
  slug,
  episode,
  key: `${host}|${slug}`,
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
