import { AuthError } from "./oauth.js";

export const API_BASE = "https://api.myanimelist.net/v2";

export function createApi({ tokens, fetch = (...args) => globalThis.fetch(...args) }) {
  async function request(method, path, { query, form } = {}) {
    const url = API_BASE + path + (query ? "?" + new URLSearchParams(query) : "");
    const send = (token) =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(form && { "Content-Type": "application/x-www-form-urlencoded" }),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });

    let res = await send(await tokens.getAccessToken());
    if (res.status === 401) {
      res = await send(await tokens.refresh());
      if (res.status === 401) {
        await tokens.signOut();
        throw new AuthError("MyAnimeList rejected the access token. Sign in again.");
      }
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(`MyAnimeList API error ${res.status}: ${text}`), {
        status: res.status,
        body: text,
      });
    }
    return res.json();
  }

  return {
    async search(q, { limit = 10, fields }) {
      const json = await request("GET", "/anime", { query: { q, limit, fields } });
      return json.data.map((d) => d.node);
    },
    details: (id, fields) => request("GET", `/anime/${id}`, { query: { fields } }),
    updateStatus: (id, form) => request("PATCH", `/anime/${id}/my_list_status`, { form }),
  };
}
