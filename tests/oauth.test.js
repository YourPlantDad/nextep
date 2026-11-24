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

async function signInWith(stored = {}) {
  const store = createStore(memoryArea(stored));
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
  const auth = createAuth({ store, fetch, identity, now: () => 1000, builtInClientId: "cid" });
  await auth.signIn();
  return { store, requests, authorizeUrl };
}

test("code exchange sends the Client ID and no secret", async () => {
  const { requests, store, authorizeUrl } = await signInWith();
  // The token exchange, then the user name lookup.
  assert.equal(requests.length, 2);
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
    obtainedAt: 1000,
  });
});

test("signIn rejects on state mismatch without exchanging", async () => {
  const store = createStore(memoryArea());
  let called = false;
  const auth = createAuth({
    store,
    builtInClientId: "cid",
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
      auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 1000 },
    }),
  );
  const auth = createAuth({ store, fetch: async () => ({ ok: false, status: 400 }), now: () => 0 });
  await assert.rejects(auth.getAccessToken(), AuthError);
  assert.equal(await store.getAuth(), null);
});

test("token far from expiry is returned without refreshing", async () => {
  const store = createStore(
    memoryArea({ auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 10 * 86400 * 1000, obtainedAt: 0 } }),
  );
  const auth = createAuth({
    store,
    fetch: async () => assert.fail("must not fetch"),
    now: () => 0,
  });
  assert.equal(await auth.getAccessToken(), "A1");
});

test("signIn uses the built-in ID and ignores an old stored Client ID and secret", async () => {
  const store = createStore(memoryArea({ settings: { clientId: "old", clientSecret: "leftover" } }));
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

test("signIn without a built-in Client ID fails before opening the sign-in page", async () => {
  let opened = false;
  const auth = createAuth({
    store: createStore(memoryArea()),
    builtInClientId: "",
    identity: {
      getRedirectURL: () => "https://ext.test/redirect",
      launchWebAuthFlow: async () => {
        opened = true;
      },
    },
  });
  await assert.rejects(auth.signIn(), {
    message: "This build has no MyAnimeList Client ID. See DEVELOPING.md.",
  });
  assert.equal(opened, false);
});

test("refresh uses the built-in Client ID and sends no secret", async () => {
  const store = createStore(
    memoryArea({
      settings: { clientId: "old", clientSecret: "leftover" },
      auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 1000 },
    }),
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

// Routes the token endpoint and the user endpoint separately.
function userEnv({ auth, userResponse }) {
  const store = createStore(memoryArea({ ...(auth && { auth }) }));
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("/users/@me")) return userResponse(init);
    return okResponse(tokenJson);
  };
  const identity = {
    getRedirectURL: () => "https://ext.test/redirect",
    launchWebAuthFlow: async ({ url }) =>
      `https://ext.test/redirect?code=C&state=${new URL(url).searchParams.get("state")}`,
  };
  return { store, calls, auth: createAuth({ store, fetch, identity, now: () => 1000 }) };
}

test("signIn stores the user name next to the tokens", async () => {
  const { store, calls, auth } = userEnv({ userResponse: async () => okResponse({ id: 1, name: "Kira" }) });
  await auth.signIn();
  assert.equal((await store.getAuth()).name, "Kira");
  assert.equal((await store.getAuth()).accessToken, "A2");
  const user = calls.find((c) => c.url === "https://api.myanimelist.net/v2/users/@me");
  assert.equal(user.init.headers.Authorization, "Bearer A2");
});

test("signIn still succeeds when the user call fails", async () => {
  for (const userResponse of [
    async () => ({ ok: false, status: 500 }),
    async () => {
      throw new TypeError("network");
    },
    async () => okResponse({ id: 1 }),
    async () => okResponse({ name: 42 }),
  ]) {
    const { store, auth } = userEnv({ userResponse });
    await auth.signIn();
    const record = await store.getAuth();
    assert.equal(record.accessToken, "A2");
    assert.equal("name" in record, false);
  }
});

test("getUserName fetches a missing name once and stores it", async () => {
  const { store, calls, auth } = userEnv({
    auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 10 * 86400 * 1000, obtainedAt: 0 },
    userResponse: async () => okResponse({ name: "Kira" }),
  });
  assert.equal(await auth.getUserName(), "Kira");
  assert.equal(await auth.getUserName(), "Kira");
  assert.equal(calls.length, 1);
  assert.equal((await store.getAuth()).name, "Kira");
});

test("getUserName never throws and returns null when signed out or failing", async () => {
  const signedOut = userEnv({ userResponse: async () => okResponse({ name: "Kira" }) });
  assert.equal(await signedOut.auth.getUserName(), null);
  const failing = userEnv({
    auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 10 * 86400 * 1000, obtainedAt: 0 },
    userResponse: async () => {
      throw new TypeError("network");
    },
  });
  assert.equal(await failing.auth.getUserName(), null);
});

test("a token refresh keeps the stored name", async () => {
  const store = createStore(
    memoryArea({ auth: { accessToken: "A1", refreshToken: "R1", expiresAt: 1000, name: "Kira" } }),
  );
  const auth = createAuth({ store, fetch: async () => okResponse(tokenJson), now: () => 0 });
  await auth.getAccessToken();
  const record = await store.getAuth();
  assert.equal(record.accessToken, "A2");
  assert.equal(record.name, "Kira");
});

const DAY = 86400 * 1000;

// A signed-in store at time 100 days, with the tokens obtained and expiring as given.
function ageEnv({ obtainedAt, expiresAt, fetch }) {
  const auth = { accessToken: "A1", refreshToken: "R1", expiresAt };
  if (obtainedAt !== undefined) auth.obtainedAt = obtainedAt;
  const store = createStore(memoryArea({ auth }));
  const requests = [];
  const wrapped = async (...args) => {
    requests.push(args);
    return fetch ? fetch(...args) : okResponse(tokenJson);
  };
  return { store, requests, auth: createAuth({ store, fetch: wrapped, now: () => 100 * DAY }) };
}

test("a token obtained under a week ago is returned without a token request", async () => {
  const { auth, requests } = ageEnv({ obtainedAt: 94 * DAY, expiresAt: 120 * DAY });
  assert.equal(await auth.getAccessToken(), "A1");
  assert.equal(requests.length, 0);
});

test("a token obtained 8 days ago is refreshed even with weeks left", async () => {
  const { auth, requests } = ageEnv({ obtainedAt: 92 * DAY, expiresAt: 125 * DAY });
  assert.equal(await auth.getAccessToken(), "A2");
  assert.equal(requests.length, 1);
});

test("a token with under 5 minutes left is refreshed even if obtained recently", async () => {
  const { auth, requests } = ageEnv({ obtainedAt: 100 * DAY - 1000, expiresAt: 100 * DAY + 4 * 60 * 1000 });
  assert.equal(await auth.getAccessToken(), "A2");
  assert.equal(requests.length, 1);
});

test("a stored record without obtainedAt is refreshed", async () => {
  const { auth, requests } = ageEnv({ expiresAt: 125 * DAY });
  assert.equal(await auth.getAccessToken(), "A2");
  assert.equal(requests.length, 1);
});

test("a refreshed record has obtainedAt set", async () => {
  const { auth, store } = ageEnv({ obtainedAt: 92 * DAY, expiresAt: 125 * DAY });
  await auth.getAccessToken();
  assert.equal((await store.getAuth()).obtainedAt, 100 * DAY);
});

test("a temporary refresh failure still returns the old token while it hasn't expired", async () => {
  const { auth, store } = ageEnv({
    obtainedAt: 92 * DAY,
    expiresAt: 125 * DAY,
    fetch: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(await auth.getAccessToken(), "A1");
  assert.equal((await store.getAuth()).accessToken, "A1");
});

// Like ageEnv, but time can move and the token request can be made to fail.
function holdEnv({ expiresAt = 125 * DAY } = {}) {
  const clock = { t: 100 * DAY };
  const state = { fail: true };
  const store = createStore(
    memoryArea({ auth: { accessToken: "A1", refreshToken: "R1", expiresAt, obtainedAt: 92 * DAY } }),
  );
  const requests = [];
  const fetch = async (...args) => {
    requests.push(args);
    return state.fail ? { ok: false, status: 503 } : okResponse(tokenJson);
  };
  return { clock, state, store, requests, auth: createAuth({ store, fetch, now: () => clock.t }) };
}

test("after a temporary refresh failure, getAccessToken waits 10 minutes before asking again", async () => {
  const { auth, clock, requests } = holdEnv();
  assert.equal(await auth.getAccessToken(), "A1");
  assert.equal(requests.length, 1);
  clock.t += 9 * 60 * 1000;
  assert.equal(await auth.getAccessToken(), "A1");
  assert.equal(requests.length, 1);
  clock.t += 2 * 60 * 1000;
  assert.equal(await auth.getAccessToken(), "A1");
  assert.equal(requests.length, 2);
});

test("a direct refresh during the hold still makes a request", async () => {
  const { auth, state, requests } = holdEnv();
  await auth.getAccessToken();
  state.fail = false;
  assert.equal(await auth.refresh(), "A2");
  assert.equal(requests.length, 2);
});

test("an expired token during the hold still tries", async () => {
  const { auth, clock, requests } = holdEnv({ expiresAt: 100 * DAY + 60 * 1000 });
  assert.equal(await auth.getAccessToken(), "A1");
  clock.t += 2 * 60 * 1000;
  await assert.rejects(auth.getAccessToken());
  assert.equal(requests.length, 2);
});

test("a successful refresh clears the hold", async () => {
  const { auth, state, store, clock, requests } = holdEnv();
  await auth.getAccessToken();
  state.fail = false;
  await auth.refresh();
  // Pretend the new token is due again right away.
  await store.setAuth({ accessToken: "A2", refreshToken: "R2", expiresAt: 125 * DAY, obtainedAt: 80 * DAY });
  state.fail = true;
  clock.t += 1000;
  await auth.getAccessToken();
  assert.equal(requests.length, 3);
});
