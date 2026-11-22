import { REPO_URL } from "../lib/config.js";
import { pickEpisode } from "../lib/url-parser.js";
import { isLastEpisode, isPaused, LIST_STATUSES } from "../lib/progress.js";

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
let confirmingRemove = false;
// Set when the popup opened by itself right after an episode was recorded.
let justRecorded = null;

const RECORDED_MAX_AGE_MS = 5000;
const AUTO_CLOSE_MS = 4000;

// Closes the popup after a moment. Moving the pointer over it or pressing a key keeps it open.
function closeSoon() {
  const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
  const keepOpen = () => clearTimeout(timer);
  document.addEventListener("pointermove", keepOpen, { once: true });
  document.addEventListener("keydown", keepOpen, { once: true });
}

async function readJustRecorded() {
  try {
    const res = await send({ type: "takeJustRecorded" });
    const found = res?.ok ? res.recorded : null;
    if (found && Date.now() - found.at <= RECORDED_MAX_AGE_MS) justRecorded = found;
  } catch {
    // Not having this line is fine.
  }
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(label, onclick, props = {}) {
  return el("button", { type: "button", textContent: label, onclick, disabled: busy, ...props });
}

async function load() {
  try {
    state = await send({ type: "getState", url: tabUrl, title: tabTitle });
    if (!state.ok) error = state.error;
  } catch {
    state = null;
    error = "Couldn't reach the extension. Close this and try again.";
  }
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
    } else if (res.result?.skip === "paused") {
      error = "This anime is on hold or dropped, so nothing was changed.";
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

const REMOVE_VALUE = "__remove";

function statusSelect(key, listStatus, disabled) {
  const select = el("select", {
    disabled,
    onchange: (e) => {
      if (e.target.value === REMOVE_VALUE) {
        // Nothing is removed until you confirm.
        confirmingRemove = true;
        paint();
        return;
      }
      act(() => send({ type: "setStatus", key, status: e.target.value }));
    },
  });
  if (!listStatus) {
    select.append(new Option("Not on your list", "", true, true));
    select.options[0].disabled = true;
  }
  for (const value of LIST_STATUSES) select.append(new Option(STATUS_LABELS[value], value));
  if (listStatus) {
    const separator = new Option("──────────", "");
    separator.disabled = true;
    select.append(separator, new Option("Remove from your list…", REMOVE_VALUE));
  }
  select.value = listStatus?.status ?? "";
  return el("label", { className: "field" }, "Status", select);
}

function removeConfirm(s, key) {
  return [
    el("p", {
      textContent: `Remove ${s.mapping.title} from your list? Your score and progress for it go too.`,
    }),
    el("div", { className: "row" },
      button("Remove", () => {
        confirmingRemove = false;
        return act(() => send({ type: "removeFromList", key }));
      }, { className: "primary" }),
      button("Keep it", () => {
        confirmingRemove = false;
        paint();
      }),
    ),
  ];
}

// One area that holds the single most useful action for this page.
function mainAction({ s, key, episode, total, watched, hasEpisode, unclear, alreadyWatched }) {
  const setWatched = (episodes, force) => () =>
    act(() => send({ type: "setWatched", key, episodes, force }));
  const noData = !s.anime;
  const status = s.anime?.listStatus?.status;
  if (!noData && isPaused(status)) {
    let next = Math.max(hasEpisode ? episode : 0, s.mapping.pausedEpisode ?? 0);
    if (total > 0) next = Math.min(next, total);
    return [
      el("p", {
        textContent:
          status === "on_hold"
            ? "You've got this anime on hold. Pick it back up?"
            : "You dropped this anime. Pick it back up?",
      }),
      el("div", { className: "row" },
        button(
          next > 0 ? `Set to watching and record episode ${next}` : "Set to watching",
          () => act(() => send({ type: "resume", key, episode: hasEpisode ? episode : null })),
          { className: "primary" },
        ),
      ),
    ];
  }
  if (!noData && isLastEpisode({ episode: hasEpisode ? episode : null, total, watched })) {
    return [
      el("p", { textContent: "This is the last episode." }),
      el("div", { className: "row" },
        button("Mark as completed", setWatched(total, false), { className: "primary" }),
      ),
    ];
  }
  if (hasEpisode) {
    return [
      el("div", { className: "row" },
        button(
          alreadyWatched ? `Episode ${episode} already watched` : `Mark episode ${episode} watched`,
          setWatched(episode, false),
          { className: "primary", disabled: busy || noData || alreadyWatched },
        ),
      ),
    ];
  }
  if (unclear) return [el("p", { className: "muted", textContent: "Can't tell which episode this page is." })];
  return [];
}

function renderConfirmed(s) {
  const { key, source } = s.parsed;
  const total = s.anime?.numEpisodes || s.mapping.numEpisodes || 0;
  const { episode } = pickEpisode(s.parsed, total);
  const watched = s.anime?.listStatus?.num_episodes_watched ?? 0;
  // The background applies the change to the count as it is when the message arrives.
  const adjustWatched = (delta) => () => act(() => send({ type: "adjustWatched", key, delta }));
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
    noData
      ? el("p", { className: "muted", textContent: "List status: unknown" })
      : statusSelect(key, s.anime.listStatus, busy),
    ...(confirmingRemove && s.anime?.listStatus
      ? removeConfirm(s, key)
      : [
          ...mainAction({ s, key, episode, total, watched, hasEpisode, unclear, alreadyWatched }),
          el(
            "div",
            { className: "row" },
            button("−1", adjustWatched(-1), { disabled: busy || noData || watched <= 0 }),
            button("+1", adjustWatched(1), { disabled: busy || noData }),
          ),
        ]),
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
      el("p", { textContent: "Is this an anime site? Open episode 1 of any anime here, then click this." }),
      button(
        "This is episode 1",
        () => act(() => send({ type: "teachStart", url: tabUrl, title: tabTitle })),
        { className: "primary" },
      ),
    );
  } else {
    nodes.push(
      el("p", { textContent: "Now open episode 2 of the same anime and click this." }),
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
  url: "The episode number is in the address.",
  title: "The episode number is in the tab title.",
  none: "This site doesn't show the episode number in the address or the tab title. Use the buttons here to update your list.",
};

function renderLearned() {
  return [
    el("p", { textContent: LEARNED_SENTENCES[learned.episodeFrom] ?? LEARNED_SENTENCES.none }),
    el("p", { className: "muted" }, "Address: ", el("code", { textContent: learned.rule.url })),
  ];
}

function renderUntracked(s) {
  if (!/^https?:/i.test(tabUrl)) {
    return [el("p", { textContent: "NextEp keeps track of the anime episodes you watch. There's nothing to track on this page." })];
  }
  const nodes = [];
  if (s.hostHasRule) {
    nodes.push(el("h1", { textContent: "This page doesn't match the rule for this site." }));
  } else {
    nodes.push(
      el("p", {
        textContent: s.generic
          ? "This looks like an anime episode page, but this site isn't enabled yet."
          : "NextEp keeps track of the anime episodes you watch. This site hasn't been added yet.",
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
  if (!state.signedIn) {
    nodes = [
      el("p", { textContent: "Sign in to MyAnimeList to start tracking." }),
      button("Open settings", () => {
        browser.runtime.openOptionsPage();
        window.close();
      }, { className: "primary" }),
    ];
  } else if (!state.parsed) nodes = renderUntracked(state);
  else if (state.mapping?.confirmed && state.mapping.malId) nodes = renderConfirmed(state);
  else nodes = renderUnconfirmed(state);

  if (learned) nodes.unshift(...renderLearned());

  if (justRecorded && justRecorded.key === state.parsed?.key) {
    const text = `Recorded episode ${justRecorded.count}.${justRecorded.completed ? " Completed." : ""}`;
    nodes.unshift(el("p", { className: "recorded", textContent: text }));
  }

  if (state.apiError) {
    error ||= state.apiError;
    errorLine.hidden = false;
    errorLine.textContent = error;
  }
  app.replaceChildren(...nodes);
}

document.getElementById("footer").append(
  el("button", {
    type: "button",
    className: "link",
    textContent: "Settings",
    onclick: () => {
      browser.runtime.openOptionsPage();
      window.close();
    },
  }),
  el("a", {
    href: `${REPO_URL}/issues/new/choose`,
    target: "_blank",
    rel: "noopener",
    textContent: "Report a problem",
  }),
);

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
tabUrl = tab?.url ?? "";
tabTitle = tab?.title ?? "";
await readJustRecorded();
await load();
if (justRecorded && justRecorded.key === state?.parsed?.key) closeSoon();
