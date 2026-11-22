import { REPO_URL } from "../lib/config.js";

const app = document.getElementById("app");
const errorLine = document.getElementById("error");
const send = (message) => browser.runtime.sendMessage(message);

const STATUS_LABELS = {
  watching: "Watching",
  completed: "Completed",
  on_hold: "On hold",
  dropped: "Dropped",
  plan_to_watch: "Plan to watch",
};

let tabUrl = "";
let state = null;
let busy = false;
let error = "";
let showSearch = false;
let query = "";
let results = [];

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(label, onclick, props = {}) {
  return el("button", { type: "button", textContent: label, onclick, disabled: busy, ...props });
}

async function load() {
  state = await send({ type: "getState", url: tabUrl });
  if (!state.ok) error = state.error;
  paint();
}

async function act(fn) {
  busy = true;
  error = "";
  paint();
  try {
    const res = await fn();
    if (!res.ok) error = res.error;
    else if (res.result?.skip === "exceeds-total") {
      error = "That episode number is higher than the total on MyAnimeList.";
    }
  } catch (e) {
    error = e.message ?? String(e);
  }
  busy = false;
  await load();
}

const candidateLabel = (c) =>
  `${c.title} · ${c.mediaType ? c.mediaType.toUpperCase() : "?"} · ${c.numEpisodes || "?"} eps`;

function candidateList(items, key) {
  return el(
    "div",
    { className: "list" },
    ...items.map((c) =>
      button(candidateLabel(c), () =>
        act(async () => {
          const res = await send({ type: "selectMapping", key, malId: c.id });
          if (res.ok) {
            showSearch = false;
            results = [];
            query = "";
          }
          return res;
        }),
      ),
    ),
  );
}

function searchBox(key) {
  const input = el("input", {
    type: "search",
    placeholder: "Search MyAnimeList",
    value: query,
    disabled: busy,
    oninput: (e) => {
      query = e.target.value;
    },
  });
  const form = el(
    "form",
    {
      className: "row",
      onsubmit: (e) => {
        e.preventDefault();
        if (!query.trim()) return;
        act(async () => {
          const res = await send({ type: "search", query: query.trim() });
          if (res.ok) results = res.results;
          return res;
        });
      },
    },
    input,
    el("button", { type: "submit", textContent: "Search", disabled: busy }),
  );
  return el("div", {}, form, candidateList(results, key));
}

function renderUnconfirmed(s) {
  const { key } = s.parsed;
  return [
    el("h1", { textContent: "Which anime is this?" }),
    s.mapping?.candidates?.length
      ? candidateList(s.mapping.candidates, key)
      : el("p", { className: "muted", textContent: "No match found automatically." }),
    searchBox(key),
  ];
}

function renderConfirmed(s) {
  const { key, episode } = s.parsed;
  const total = s.anime?.numEpisodes || s.mapping.numEpisodes || 0;
  const watched = s.anime?.listStatus?.num_episodes_watched ?? 0;
  const status = s.anime
    ? (STATUS_LABELS[s.anime.listStatus?.status] ?? "Not on your list")
    : "Unknown";
  const setWatched = (episodes, force) => () =>
    act(() => send({ type: "setWatched", key, episodes, force }));
  const noData = !s.anime;
  const alreadyWatched = !noData && episode <= watched;
  return [
    el("h1", {}, el("a", {
      href: `https://myanimelist.net/anime/${s.mapping.malId}`,
      target: "_blank",
      rel: "noopener",
      textContent: s.mapping.title,
    })),
    el("p", { textContent: `Watched ${watched} / ${total || "?"}` }),
    el("p", { className: "muted", textContent: `List status: ${status}` }),
    el(
      "div",
      { className: "row" },
      button("−1", setWatched(watched - 1, true), { disabled: busy || noData || watched <= 0 }),
      button("+1", setWatched(watched + 1, true), { disabled: busy || noData }),
    ),
    el("div", { className: "row" },
      button(
        alreadyWatched ? `Episode ${episode} already watched` : `Mark episode ${episode} watched`,
        setWatched(episode, false),
        { className: "primary", disabled: busy || noData || alreadyWatched },
      ),
    ),
    showSearch
      ? searchBox(key)
      : el("button", {
          type: "button",
          className: "link",
          textContent: "Wrong anime?",
          onclick: () => {
            showSearch = true;
            paint();
          },
        }),
  ];
}

function renderUntracked(s) {
  const nodes = [
    el("p", {
      textContent: s.generic
        ? "This site isn't enabled yet."
        : "This page isn't a tracked episode page.",
    }),
  ];
  if (s.generic) {
    nodes.push(
      el("p", {
        className: "muted",
        textContent: `Detected "${s.generic.slug}", episode ${s.generic.episode}.`,
      }),
      button(
        `Enable on ${s.generic.host}`,
        () => act(() => send({ type: "enableSite", url: tabUrl })),
        { className: "primary" },
      ),
    );
  }
  return nodes;
}

function paint() {
  errorLine.hidden = !error;
  errorLine.textContent = error;
  if (!state?.ok) {
    app.replaceChildren();
    return;
  }
  let nodes;
  if (!state.hasClientId || !state.signedIn) {
    nodes = [
      el("p", {
        textContent: state.hasClientId
          ? "Sign in to MyAnimeList to start tracking."
          : "This build has no built-in Client ID. Add your own in the settings, then sign in.",
      }),
      button("Open settings", () => {
        browser.runtime.openOptionsPage();
        window.close();
      }, { className: "primary" }),
    ];
  } else if (!state.parsed) nodes = renderUntracked(state);
  else if (state.mapping?.confirmed && state.mapping.malId) nodes = renderConfirmed(state);
  else nodes = renderUnconfirmed(state);

  if (state.apiError) {
    error ||= state.apiError;
    errorLine.hidden = false;
    errorLine.textContent = error;
  }
  app.replaceChildren(...nodes);
}

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
tabUrl = tab?.url ?? "";
await load();

document.getElementById("footer").append(
  el("a", {
    href: `${REPO_URL}/issues/new/choose`,
    target: "_blank",
    rel: "noopener",
    textContent: "Report a problem",
  }),
);
