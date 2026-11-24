import { AuthError } from "./oauth.js";

export const API_BASE = "https://api.myanimelist.net/v2";

// MAL publishes no rate limits, and answers 403 when it thinks it's being flooded. After a
// refusal the automatic calls wait: a minute, then twice as long each time, up to half an hour.
export const PAUSE_FIRST_MS = 60 * 1000;
export const PAUSE_MAX_MS = 30 * 60 * 1000;

export const pauseDelay = (refusals) => Math.min(PAUSE_FIRST_MS * 2 ** (refusals - 1), PAUSE_MAX_MS);

// A network error has no status. Nothing reached MAL, so it isn't a refusal.
const isRefusal = (status) => status === 403 || status === 429 || status >= 500;

export function createApi({ tokens, fetch = (...args) => globalThis.fetch(...args), now = Date.now }) {
  let refusals = 0;
  let until = 0;

  function noteStatus(status) {
    if (!isRefusal(status)) {
      refusals = 0;
      until = 0;
      return;
    }
    refusals++;
    until = Math.max(until, now() + pauseDelay(refusals));
  }

  // The token calls talk to MAL too, so their refusals count the same way.
  async function viaTokens(call) {
    try {
      return await call();
    } catch (e) {
      if (isRefusal(e?.status)) noteStatus(e.status);
      throw e;
    }
  }

  async function request(method, path, { query, form, okWhen404 = false } = {}) {
    const url = API_BASE + path + (query ? "?" + new URLSearchParams(query) : "");
    const send = async (token) => {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(form && { "Content-Type": "application/x-www-form-urlencoded" }),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });
      noteStatus(res.status);
      return res;
    };

    let res = await send(await viaTokens(() => tokens.getAccessToken()));
    if (res.status === 401) {
      res = await send(await viaTokens(() => tokens.refresh()));
      if (res.status === 401) {
        await tokens.signOut();
        throw new AuthError("MyAnimeList rejected the access token. Sign in again.");
      }
    }
    if (okWhen404 && res.status === 404) return null;
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(`MyAnimeList API error ${res.status}: ${text}`), {
        status: res.status,
        body: text,
      });
    }
    // A DELETE can come back with nothing at all, so don't assume there's JSON.
    const body = await res.text();
    return body.trim() ? JSON.parse(body) : null;
  }

  return {
    // When automatic calls may start again, or 0. The calls themselves are never blocked here.
    pausedUntil: () => (until > now() ? until : 0),
    async search(q, { limit = 10, fields }) {
      const json = await request("GET", "/anime", { query: { q, limit, fields } });
      return json.data.map((d) => d.node);
    },
    details: (id, fields) => request("GET", `/anime/${id}`, { query: { fields } }),
    updateStatus: (id, form) => request("PATCH", `/anime/${id}/my_list_status`, { form }),
    // A 404 means it wasn't on the list, which is the result a remove wants anyway.
    removeStatus: async (id) => {
      await request("DELETE", `/anime/${id}/my_list_status`, { okWhen404: true });
    },
  };
}
