import { BUILT_IN_CLIENT_ID, resolveClient } from "./config.js";

export const AUTHORIZE_URL = "https://myanimelist.net/v1/oauth2/authorize";
export const TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

export function randomString(length, getRandomValues = (a) => crypto.getRandomValues(a)) {
  // Rejection sampling, so there's no modulo bias.
  const limit = 256 - (256 % CHARSET.length);
  let out = "";
  while (out.length < length) {
    for (const b of getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += CHARSET[b % CHARSET.length];
    }
  }
  return out;
}

// MAL only does the "plain" PKCE method, so the challenge is the verifier.
export function buildAuthorizeUrl({ clientId, redirectUri, state, verifier }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
    code_challenge: verifier,
    code_challenge_method: "plain",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export function parseRedirect(responseUrl, expectedState) {
  const params = new URL(responseUrl).searchParams;
  if (params.get("error")) throw new Error(`MyAnimeList authorization failed: ${params.get("error")}`);
  if (params.get("state") !== expectedState) throw new Error("OAuth state mismatch.");
  const code = params.get("code");
  if (!code) throw new Error("MyAnimeList did not return an authorization code.");
  return code;
}

async function tokenRequest(fetch, fields, clientSecret) {
  const body = new URLSearchParams(fields);
  if (clientSecret) body.set("client_secret", clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Token request failed (HTTP ${res.status}).`), {
      status: res.status,
    });
  }
  return res.json();
}

function toAuth(json, now) {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now() + json.expires_in * 1000,
  };
}

export function createAuth({
  store,
  fetch = (...args) => globalThis.fetch(...args),
  now = Date.now,
  identity,
  builtInClientId = BUILT_IN_CLIENT_ID,
}) {
  const getIdentity = () => identity ?? browser.identity;
  let inflight = null;

  async function doRefresh() {
    const [settings, auth] = await Promise.all([store.getSettings(), store.getAuth()]);
    const { clientId, clientSecret } = resolveClient(settings, builtInClientId);
    if (!auth?.refreshToken) throw new AuthError("Not signed in.");
    try {
      const json = await tokenRequest(
        fetch,
        {
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: auth.refreshToken,
        },
        clientSecret,
      );
      const next = toAuth(json, now);
      await store.setAuth(next);
      return next.accessToken;
    } catch (e) {
      if (e.status === 400 || e.status === 401) {
        await store.clearAuth();
        throw new AuthError("MyAnimeList session expired. Sign in again.");
      }
      throw e;
    }
  }

  // Refreshing revokes the old access token, so callers have to share one request.
  function refresh() {
    inflight ??= doRefresh().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function getAccessToken() {
    const auth = await store.getAuth();
    if (!auth?.accessToken) throw new AuthError("Not signed in.");
    if (auth.expiresAt - now() > REFRESH_WINDOW_MS) return auth.accessToken;
    try {
      return await refresh();
    } catch (e) {
      // A temporary failure shouldn't block a token that hasn't expired yet.
      if (e instanceof AuthError || auth.expiresAt <= now()) throw e;
      return auth.accessToken;
    }
  }

  async function signIn() {
    const { clientId, clientSecret } = resolveClient(await store.getSettings(), builtInClientId);
    if (!clientId) throw new Error("No Client ID. Enter your own under Advanced in the settings.");
    const redirectUri = getIdentity().getRedirectURL();
    const verifier = randomString(64);
    const state = randomString(32);
    const responseUrl = await getIdentity().launchWebAuthFlow({
      url: buildAuthorizeUrl({ clientId, redirectUri, state, verifier }),
      interactive: true,
    });
    const code = parseRedirect(responseUrl, state);
    const json = await tokenRequest(
      fetch,
      {
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      },
      clientSecret,
    );
    await store.setAuth(toAuth(json, now));
  }

  return { getAccessToken, refresh, signIn, signOut: () => store.clearAuth() };
}
