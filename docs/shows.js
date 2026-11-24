// The two demo shows and the pure functions that turn pages into episodes and back.
// There is no DOM code here, so Node can import this file in a test.

// "path" shows have the episode number in the address (watch/<slug>/ep-<n>/).
// "title" shows only have it in the tab title, and the address holds an unrelated id.
export const SHOWS = [
  { name: "Death Parade", slug: "death-parade", total: 12, shape: "path" },
  { name: "Cowboy Bebop", slug: "cowboy-bebop-1", total: 26, shape: "title" },
];

export const SITE_NAME = "NextEp demo";

// The id in the address is deliberately not the episode number, so NextEp has to read the title.
const ID_BASE = 4100;
const ID_STEP = 3;

export const showBySlug = (slug) => SHOWS.find((show) => show.slug === slug) ?? null;

const isEpisode = (show, n) => Number.isInteger(n) && n >= 1 && n <= show.total;

// The site may be served from any base path, so only the trailing pieces count.
const pieces = (pathname) => pathname.split("/").filter(Boolean);

export function showFromPath(pathname) {
  return SHOWS.find((show) => pieces(pathname).includes(show.slug)) ?? null;
}

// Episode of a "path" show, or null if the address has none.
export function episodeFromPath(pathname, show) {
  const parts = pieces(pathname);
  const m = /^ep-(\d+)$/.exec(parts.at(-1) ?? "");
  if (!m || parts.at(-2) !== show.slug) return null;
  const n = Number.parseInt(m[1], 10);
  return isEpisode(show, n) ? n : null;
}

export const idFromEpisode = (episode) => ID_BASE + ID_STEP * episode;

export const queryFromEpisode = (episode) => `?ep=${idFromEpisode(episode)}`;

// Episode of a "title" show. A missing or unknown id means episode 1.
export function episodeFromQuery(search, show) {
  const id = Number(new URLSearchParams(search).get("ep"));
  const n = (id - ID_BASE) / ID_STEP;
  return isEpisode(show, n) ? n : 1;
}

export function episodeFromLocation(location, show) {
  if (show.shape === "path") return episodeFromPath(location.pathname, show);
  return episodeFromQuery(location.search, show);
}

export const pageTitle = (show, episode) => `${show.name} Episode ${episode} | ${SITE_NAME}`;

// Address of an episode page, relative to the site root.
export function episodeAddress(show, episode) {
  if (show.shape === "path") return `watch/${show.slug}/ep-${episode}/`;
  return `player/${show.slug}/${queryFromEpisode(episode)}`;
}
