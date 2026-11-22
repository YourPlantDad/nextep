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
