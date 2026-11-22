// Fakes for loading src/background/main.js outside Firefox. Not a test file.

const clone = (v) => (v === undefined ? v : structuredClone(v));

// A fake `browser` global. Only what main.js and the libs it imports touch.
export function createBrowser({ storage = {}, tabs = [], windows = [] } = {}) {
  const data = clone(storage);
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  const windowMap = new Map(windows.map((w) => [w.id, w]));
  const calls = { badgeText: [], badgeColor: [], openPopup: [] };
  const listeners = { onUpdated: [], onMessage: [] };
  const redirectUrl = "https://redirect.example.test/cb";

  const keysOf = (keys) => (keys == null ? Object.keys(data) : [].concat(keys));

  const browser = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of keysOf(keys)) if (k in data) out[k] = clone(data[k]);
          return out;
        },
        async set(obj) {
          Object.assign(data, clone(obj));
        },
        async remove(keys) {
          for (const k of keysOf(keys)) delete data[k];
        },
      },
    },
    tabs: {
      onUpdated: {
        addListener(fn, filter) {
          listeners.onUpdated.push({ fn, filter });
        },
      },
      async query({ active, lastFocusedWindow } = {}) {
        return [...tabMap.values()].filter(
          (t) => (active === undefined || Boolean(t.active) === active) && lastFocusedWindow !== false,
        );
      },
      async get(id) {
        if (!tabMap.has(id)) throw new Error(`Invalid tab ID: ${id}`);
        return clone(tabMap.get(id));
      },
    },
    windows: {
      async get(id) {
        return clone(windowMap.get(id) ?? { id, focused: true });
      },
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.onMessage.push(fn);
        },
      },
      getURL: (path) => `moz-extension://fake-id/${String(path).replace(/^\//, "")}`,
    },
    browserAction: {
      async setBadgeText(details) {
        calls.badgeText.push(clone(details));
      },
      async setBadgeBackgroundColor(details) {
        calls.badgeColor.push(clone(details));
      },
      async openPopup(details) {
        calls.openPopup.push(clone(details));
      },
    },
    identity: {
      getRedirectURL: () => redirectUrl,
      async launchWebAuthFlow({ url }) {
        const state = new URL(url).searchParams.get("state");
        return `${redirectUrl}?code=fake-code&state=${state}`;
      },
    },
  };

  return {
    browser,
    data,
    calls,
    listeners,
    tabs: tabMap,
    windows: windowMap,
  };
}

const normalize = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A fake fetch over an in-memory MyAnimeList. anime: [{id, title, num_episodes, list?}] where
// list is {status, num_episodes_watched} or absent when the show is not on the list.
export function createMal({ anime = [], userName = "ExampleUser" } = {}) {
  const model = new Map(anime.map((a) => [a.id, structuredClone(a)]));
  const requests = [];

  const node = (a) => ({
    id: a.id,
    title: a.title,
    media_type: a.media_type ?? "tv",
    num_episodes: a.num_episodes ?? 0,
    alternative_titles: { synonyms: [], en: "" },
    ...(a.list ? { my_list_status: { ...a.list } } : {}),
  });

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body === undefined ? null : String(init.body);
    requests.push({ method, url: url.href, path: url.pathname, query: url.searchParams, body });
    const form = body ? new URLSearchParams(body) : new URLSearchParams();

    if (url.host === "myanimelist.net" && url.pathname === "/v1/oauth2/token") {
      return json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 2678400 });
    }
    if (url.host !== "api.myanimelist.net") return json({ error: "not_found" }, 404);

    if (method === "GET" && url.pathname === "/v2/users/@me") return json({ id: 1, name: userName });

    if (method === "GET" && url.pathname === "/v2/anime") {
      const q = normalize(url.searchParams.get("q"));
      const hits = [...model.values()].filter((a) => normalize(a.title).includes(q));
      return json({ data: hits.map((a) => ({ node: node(a) })) });
    }

    const m = /^\/v2\/anime\/(\d+)(\/my_list_status)?$/.exec(url.pathname);
    const entry = m && model.get(Number(m[1]));
    if (!entry) return json({ error: "not_found" }, 404);

    if (method === "GET" && !m[2]) return json(node(entry));
    if (method === "PATCH" && m[2]) {
      const list = entry.list ?? { status: "plan_to_watch", num_episodes_watched: 0 };
      if (form.has("status")) list.status = form.get("status");
      if (form.has("num_watched_episodes")) {
        list.num_episodes_watched = Number(form.get("num_watched_episodes"));
      }
      entry.list = list;
      return json({ ...list });
    }
    if (method === "DELETE" && m[2]) {
      if (!entry.list) return json({ error: "not_found" }, 404);
      delete entry.list;
      return new Response("", { status: 200 });
    }
    return json({ error: "not_found" }, 404);
  }

  const patches = () =>
    requests
      .filter((r) => r.method === "PATCH")
      .map((r) => ({ path: r.path, form: Object.fromEntries(new URLSearchParams(r.body)) }));

  return { fetch, requests, model, patches };
}
