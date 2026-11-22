import { REPO_URL } from "../lib/config.js";
import { pickEpisode } from "../lib/url-parser.js";

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
let tabTitle = "";
let state = null;
let busy = false;
let error = "";
let showSearch = false;
let query = "";
let results = [];
let learned = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(label, onclick, props = {}) {
  return el("button", { type: "button", textContent: label, onclick, disabled: busy, ...props });
}

async function load() {
  state = await send({ type: "getState", url: tabUrl, title: tabTitle });
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
  const { key, source } = s.parsed;
  const total = s.anime?.numEpisodes || s.mapping.numEpisodes || 0;
  const { episode } = pickEpisode(s.parsed, total);
  const watched = s.anime?.listStatus?.num_episodes_watched ?? 0;
  const status = s.anime
    ? (STATUS_LABELS[s.anime.listStatus?.status] ?? "Not on your list")
    : "Unknown";
  const setWatched = (episodes, force) => () =>
    act(() => send({ type: "setWatched", key, episodes, force }));
  const noData = !s.anime;
  const hasEpisode = episode !== null && !(total > 0 && episode > total);
  const unclear = source !== "none" && !hasEpisode;
  const alreadyWatched = hasEpisode && !noData && episode <= watched;
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
    ...(hasEpisode
      ? [
          el("div", { className: "row" },
            button(
              alreadyWatched ? `Episode ${episode} already watched` : `Mark episode ${episode} watched`,
              setWatched(episode, false),
              { className: "primary", disabled: busy || noData || alreadyWatched },
            ),
          ),
        ]
      : unclear
        ? [el("p", { className: "muted", textContent: "I can't tell which episode this page is." })]
        : []),
    ...(source === "none"
      ? [el("p", { className: "muted", textContent: "This site can't be tracked automatically." })]
      : []),
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

function teachSection(s) {
  const nodes = [];
  if (!s.teach) {
    nodes.push(
      el("p", { textContent: "Open episode 1 of any show on this site, then click this." }),
      button(
        "This is episode 1",
        () => act(() => send({ type: "teachStart", url: tabUrl, title: tabTitle })),
        { className: "primary" },
      ),
    );
  } else {
    nodes.push(
      el("p", { textContent: "Now open episode 2 of the same show and click this." }),
      button(
        "This is episode 2",
        async () => {
          await act(async () => {
            const res = await send({ type: "teachFinish", url: tabUrl, title: tabTitle });
            if (res.ok) learned = res;
            return res;
          });
        },
        { className: "primary" },
      ),
      el("button", {
        type: "button",
        className: "link",
        textContent: "Start over",
        disabled: busy,
        onclick: () => act(() => send({ type: "teachCancel" })),
      }),
    );
  }
  return [el("div", { className: "teach" }, ...nodes)];
}

const LEARNED_SENTENCES = {
  url: "I found the episode number in the address.",
  title: "I found the episode number in the tab title.",
  none: "I couldn't find the episode number on this site, so use the buttons here to update your list.",
};

function renderLearned() {
  return [
    el("p", { textContent: LEARNED_SENTENCES[learned.episodeFrom] ?? LEARNED_SENTENCES.none }),
    el("p", { className: "muted" }, "Address: ", el("code", { textContent: learned.rule.url })),
  ];
}

function renderUntracked(s) {
  if (!/^https?:/i.test(tabUrl)) {
    return [el("p", { textContent: "This page isn't a tracked episode page." })];
  }
  const nodes = [];
  if (s.hostHasRule) {
    nodes.push(el("h1", { textContent: "This page doesn't match the rule for this site." }));
  } else {
    nodes.push(
      el("p", {
        textContent: s.generic
          ? "This site isn't enabled yet."
          : "This page isn't a tracked episode page.",
      }),
    );
  }
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
  nodes.push(...teachSection(s));
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

  if (learned) nodes.unshift(...renderLearned());

  if (state.apiError) {
    error ||= state.apiError;
    errorLine.hidden = false;
    errorLine.textContent = error;
  }
  app.replaceChildren(...nodes);
}

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
tabUrl = tab?.url ?? "";
tabTitle = tab?.title ?? "";
await load();

document.getElementById("footer").append(
  el("a", {
    href: `${REPO_URL}/issues/new/choose`,
    target: "_blank",
    rel: "noopener",
    textContent: "Report a problem",
  }),
);
