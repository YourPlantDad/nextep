import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/lib/mal-api.js";
import { AuthError } from "../src/lib/oauth.js";

const res = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

function makeTokens() {
  const t = { refreshes: 0, signedOut: false };
  t.getAccessToken = async () => "old";
  t.refresh = async () => {
    t.refreshes++;
    return "new";
  };
  t.signOut = async () => {
    t.signedOut = true;
  };
  return t;
}

test("401 -> refresh -> retry once with the new token", async () => {
  const tokens = makeTokens();
  const seen = [];
  const fetch = async (url, init) => {
    seen.push(init.headers.Authorization);
    return seen.length === 1 ? res(401) : res(200, { id: 5 });
  };
  const api = createApi({ tokens, fetch });
  assert.deepEqual(await api.details(5, "num_episodes"), { id: 5 });
  assert.deepEqual(seen, ["Bearer old", "Bearer new"]);
  assert.equal(tokens.refreshes, 1);
});

test("second 401 signs out and throws AuthError", async () => {
  const tokens = makeTokens();
  const api = createApi({ tokens, fetch: async () => res(401) });
  await assert.rejects(api.details(5, "x"), AuthError);
  assert.equal(tokens.signedOut, true);
  assert.equal(tokens.refreshes, 1);
});

test("PATCH sends a form-urlencoded body", async () => {
  let call;
  const api = createApi({
    tokens: makeTokens(),
    fetch: async (url, init) => {
      call = { url, init };
      return res(200, { status: "watching" });
    },
  });
  await api.updateStatus(7, { num_watched_episodes: 4, status: "watching" });
  assert.equal(call.url, "https://api.myanimelist.net/v2/anime/7/my_list_status");
  assert.equal(call.init.method, "PATCH");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(call.init.headers.Authorization, "Bearer old");
  assert.equal(call.init.body, "num_watched_episodes=4&status=watching");
});

test("search builds the query and unwraps nodes", async () => {
  let url;
  const api = createApi({
    tokens: makeTokens(),
    fetch: async (u) => {
      url = new URL(u);
      return res(200, { data: [{ node: { id: 1, title: "A" } }] });
    },
  });
  assert.deepEqual(await api.search("one piece", { limit: 10, fields: "a,b" }), [{ id: 1, title: "A" }]);
  assert.equal(url.pathname, "/v2/anime");
  assert.equal(url.searchParams.get("q"), "one piece");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("fields"), "a,b");
});

test("non-2xx throws with status and truncated body", async () => {
  const api = createApi({ tokens: makeTokens(), fetch: async () => res(500, "x".repeat(1000)) });
  await assert.rejects(api.details(1, "x"), (e) => {
    assert.equal(e.status, 500);
    assert.equal(e.body.length, 300);
    return true;
  });
});

test("removeStatus sends DELETE with the bearer header", async () => {
  let call;
  const api = createApi({
    tokens: makeTokens(),
    fetch: async (url, init) => {
      call = { url, init };
      return res(200, []);
    },
  });
  await api.removeStatus(7);
  assert.equal(call.url, "https://api.myanimelist.net/v2/anime/7/my_list_status");
  assert.equal(call.init.method, "DELETE");
  assert.equal(call.init.headers.Authorization, "Bearer old");
});

test("removeStatus is fine with an empty 200 body", async () => {
  const api = createApi({ tokens: makeTokens(), fetch: async () => res(200, "") });
  await api.removeStatus(7);
});

test("removeStatus treats 404 as already off the list", async () => {
  const api = createApi({ tokens: makeTokens(), fetch: async () => res(404, "not found") });
  await api.removeStatus(7);
});

test("removeStatus does 401 -> refresh -> retry", async () => {
  const tokens = makeTokens();
  const seen = [];
  const api = createApi({
    tokens,
    fetch: async (url, init) => {
      seen.push(init.headers.Authorization);
      return seen.length === 1 ? res(401) : res(200, "");
    },
  });
  await api.removeStatus(7);
  assert.deepEqual(seen, ["Bearer old", "Bearer new"]);
  assert.equal(tokens.refreshes, 1);
});

const MINUTE = 60 * 1000;

function pausing(status, extra = {}) {
  const clock = { t: 1000 };
  const state = { status };
  const api = createApi({
    tokens: extra.tokens ?? makeTokens(),
    fetch: async () => res(state.status, { id: 1 }),
    now: () => clock.t,
  });
  const hit = () => api.details(1, "x").catch(() => {});
  return { api, clock, state, hit };
}

test("each refusal doubles the wait, up to 30 minutes", async () => {
  const { api, clock, hit } = pausing(403);
  assert.equal(api.pausedUntil(), 0);
  for (const minutes of [1, 2, 4, 8, 16, 30, 30]) {
    await hit();
    assert.equal(api.pausedUntil(), clock.t + minutes * MINUTE);
    clock.t = api.pausedUntil();
  }
});

test("429 and 5xx statuses pause too", async () => {
  for (const status of [429, 500, 503]) {
    const { api, clock, hit } = pausing(status);
    await hit();
    assert.equal(api.pausedUntil(), clock.t + MINUTE, String(status));
  }
});

test("pausedUntil is 0 again once the wait has passed", async () => {
  const { api, clock, hit } = pausing(403);
  await hit();
  clock.t += MINUTE;
  assert.equal(api.pausedUntil(), 0);
});

test("a normal answer resets the count and clears the pause", async () => {
  const { api, clock, state, hit } = pausing(403);
  await hit();
  clock.t = api.pausedUntil();
  await hit();
  state.status = 200;
  await hit();
  assert.equal(api.pausedUntil(), 0);
  state.status = 403;
  await hit();
  assert.equal(api.pausedUntil(), clock.t + MINUTE);
});

test("a 400 or a 404 does not pause and clears an earlier pause", async () => {
  for (const status of [400, 404]) {
    const { api, state, hit } = pausing(403);
    await hit();
    assert.ok(api.pausedUntil() > 0);
    state.status = status;
    await hit();
    assert.equal(api.pausedUntil(), 0, String(status));
  }
});

test("a network error does not pause", async () => {
  const api = createApi({
    tokens: makeTokens(),
    fetch: async () => {
      throw new TypeError("network");
    },
    now: () => 1000,
  });
  await assert.rejects(api.details(1, "x"), TypeError);
  assert.equal(api.pausedUntil(), 0);
});

test("a refusal status thrown by the token provider pauses", async () => {
  for (const method of ["getAccessToken", "refresh"]) {
    const tokens = makeTokens();
    tokens[method] = async () => {
      throw Object.assign(new Error("Token request failed."), { status: 503 });
    };
    // For refresh, the first answer has to be a 401 so a refresh is tried.
    const api = createApi({
      tokens,
      fetch: async () => res(401),
      now: () => 1000,
    });
    await assert.rejects(api.details(1, "x"), (e) => e.status === 503);
    assert.equal(api.pausedUntil(), 1000 + MINUTE, method);
  }
});

test("a token provider error with no status does not pause", async () => {
  const tokens = makeTokens();
  tokens.getAccessToken = async () => {
    throw new AuthError("Not signed in.");
  };
  const api = createApi({ tokens, fetch: async () => res(200), now: () => 1000 });
  await assert.rejects(api.details(1, "x"), AuthError);
  assert.equal(api.pausedUntil(), 0);
});
