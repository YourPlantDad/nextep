import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizeUrl,
  randomString,
  parseRedirect,
  createAuth,
  AuthError,
} from "../src/lib/oauth.js";
import { createStore } from "../src/lib/store.js";

function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
    async remove(key) {
      delete data[key];
    },
  };
}

const tokenJson = { token_type: "Bearer", expires_in: 2592000, access_token: "A2", refresh_token: "R2" };
const okResponse = (json) => ({ ok: true, status: 200, json: async () => json });

test("authorize URL has all params and challenge equals verifier", () => {
  const verifier = randomString(64);
  const url = new URL(
    buildAuthorizeUrl({ clientId: "cid", redirectUri: "https://x.test/cb", state: "st", verifier }),
  );
  assert.equal(url.origin + url.pathname, "https://myanimelist.net/v1/oauth2/authorize");
  const p = url.searchParams;
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("client_id"), "cid");
  assert.equal(p.get("state"), "st");
  assert.equal(p.get("redirect_uri"), "https://x.test/cb");
  assert.equal(p.get("code_challenge_method"), "plain");
  assert.equal(p.get("code_challenge"), verifier);
});

test("verifier has length 64 and only allowed characters; values differ", () => {
  const a = randomString(64);
  assert.equal(a.length, 64);
  assert.match(a, /^[A-Za-z0-9\-._~]{64}$/);
  assert.notEqual(a, randomString(64));
});

test("parseRedirect rejects state mismatch, error and missing code", () => {
  assert.equal(parseRedirect("https://r.test/?code=C&state=S", "S"), "C");
  assert.throws(() => parseRedirect("https://r.test/?code=C&state=other", "S"), /state/);
  assert.throws(() => parseRedirect("https://r.test/?error=access_denied&state=S", "S"), /access_denied/);
  assert.throws(() => parseRedirect("https://r.test/?state=S", "S"), /code/);
});

async function signInWith(settings) {
  const store = createStore(memoryArea({ settings }));
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return okResponse(tokenJson);
  };
  let authorizeUrl;
  const identity = {
    getRedirectURL: () => "https://ext.test/redirect",
    launchWebAuthFlow: async ({ url }) => {
      authorizeUrl = new URL(url);
      return `https://ext.test/redirect?code=CODE&state=${authorizeUrl.searchParams.get("state")}`;
    },
  };
  const auth = createAuth({ store, fetch, identity, now: () => 1000 });
  await auth.signIn();
  return { store, requests, authorizeUrl };
}

test("code exchange omits client_secret when not configured", async () => {
  const { requests, store, authorizeUrl } = await signInWith({ clientId: "cid" });
  assert.equal(requests.length, 1);
  const body = new URLSearchParams(requests[0].init.body);
  assert.equal(requests[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(body.has("client_secret"), false);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "CODE");
  assert.equal(body.get("client_id"), "cid");
  assert.equal(body.get("redirect_uri"), "https://ext.test/redirect");
  assert.equal(body.get("code_verifier"), authorizeUrl.searchParams.get("code_challenge"));
  assert.deepEqual(await store.getAuth(), {
    accessToken: "A2",
    refreshToken: "R2",
    expiresAt: 1000 + 2592000 * 1000,
  });
});

test("code exchange includes client_secret when configured", async () => {
  const { requests } = await signInWith({ clientId: "cid", clientSecret: "sek" });
  assert.equal(new URLSearchParams(requests[0].init.body).get("client_secret"), "sek");
});

test("signIn rejects on state mismatch without exchanging", async () => {
  const store = createStore(memoryArea({ settings: { clientId: "cid" } }));
  let called = false;
  const auth = createAuth({
    store,
    fetch: async () => {
      called = true;
    },
    identity: {
      getRedirectURL: () => "https://ext.test/redirect",
      launchWebAuthFlow: async () => "https://ext.test/redirect?code=C&state=wrong",
    },
  });
  await assert.rejects(auth.signIn(), /state/);
  assert.equal(called, false);
});

test("refresh is single-flight", async () => {
  const store = createStore(
    memoryArea({
      settings: { clientId: "cid" },
      auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 1000 },
    }),
  );
  let calls = 0;
  const fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return okResponse(tokenJson);
  };
  const auth = createAuth({ store, fetch, now: () => 0 });
  const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  assert.equal(calls, 1);
  assert.equal(a, "A2");
  assert.equal(b, "A2");
});

test("refresh failing with 400 clears auth and throws AuthError", async () => {
  const store = createStore(
    memoryArea({
      settings: { clientId: "cid" },
      auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 1000 },
    }),
  );
  const auth = createAuth({ store, fetch: async () => ({ ok: false, status: 400 }), now: () => 0 });
  await assert.rejects(auth.getAccessToken(), AuthError);
  assert.equal(await store.getAuth(), null);
});

test("token far from expiry is returned without refreshing", async () => {
  const store = createStore(
    memoryArea({ auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 10 * 86400 * 1000 } }),
  );
  const auth = createAuth({
    store,
    fetch: async () => assert.fail("must not fetch"),
    now: () => 0,
  });
  assert.equal(await auth.getAccessToken(), "A1");
});

import { resolveClient } from "../src/lib/config.js";

test("resolveClient: override wins and carries its secret", () => {
  assert.deepEqual(resolveClient({ clientId: " mine ", clientSecret: " s " }, "builtin"), {
    clientId: "mine",
    clientSecret: "s",
  });
  assert.deepEqual(resolveClient({ clientId: "mine", clientSecret: "" }, "builtin"), {
    clientId: "mine",
    clientSecret: undefined,
  });
});

test("resolveClient: built-in ID never carries a secret", () => {
  assert.deepEqual(resolveClient({ clientId: "  ", clientSecret: "leftover" }, "builtin"), {
    clientId: "builtin",
    clientSecret: undefined,
  });
  assert.deepEqual(resolveClient({}, ""), { clientId: "", clientSecret: undefined });
});

test("signIn uses the built-in ID and never sends a secret with it", async () => {
  const store = createStore(memoryArea({ settings: { clientSecret: "leftover" } }));
  const bodies = [];
  const auth = createAuth({
    store,
    builtInClientId: "builtin",
    fetch: async (url, init) => {
      bodies.push(new URLSearchParams(init.body));
      return okResponse(tokenJson);
    },
    identity: {
      getRedirectURL: () => "https://ext.test/redirect",
      launchWebAuthFlow: async ({ url }) => {
        assert.equal(new URL(url).searchParams.get("client_id"), "builtin");
        return `https://ext.test/redirect?code=C&state=${new URL(url).searchParams.get("state")}`;
      },
    },
  });
  await auth.signIn();
  assert.equal(bodies[0].get("client_id"), "builtin");
  assert.equal(bodies[0].has("client_secret"), false);
});

test("signIn without any client ID fails", async () => {
  const auth = createAuth({ store: createStore(memoryArea()), builtInClientId: "" });
  await assert.rejects(auth.signIn(), /Client ID/);
});

test("refresh uses the effective client ID", async () => {
  const store = createStore(
    memoryArea({ auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 1000 } }),
  );
  let body;
  const auth = createAuth({
    store,
    builtInClientId: "builtin",
    now: () => 0,
    fetch: async (url, init) => {
      body = new URLSearchParams(init.body);
      return okResponse(tokenJson);
    },
  });
  await auth.getAccessToken();
  assert.equal(body.get("client_id"), "builtin");
  assert.equal(body.has("client_secret"), false);
});
