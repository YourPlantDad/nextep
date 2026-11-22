// Learns a site rule from two pages: episode 1 and episode 2 of the same show.
import { toHttpUrl, addressText, siteHost } from "./template.js";

const isAlnum = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const LEADING_SEPARATORS = /^[\s\-\u2013\u2014:|·]+/;
const TRAILING_SEPARATORS = /[\s\-\u2013\u2014:|·]+$/;

// Stands in for the part that differs while I look at the rest of the address.
const MARK = "";

// Finds the part that differs between a and b. The edges never cut through a run of
// letters or digits, so 136407 and 136408 stay whole.
function diff(a, b) {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  while (p > 0 && isAlnum(a[p - 1]) && (isAlnum(a[p]) || isAlnum(b[p]))) p--;
  while (
    s > 0 &&
    isAlnum(a[a.length - s]) &&
    (isAlnum(a[a.length - s - 1]) || isAlnum(b[b.length - s - 1]))
  ) {
    s--;
  }
  return { p, s, a: a.slice(p, a.length - s), b: b.slice(p, b.length - s) };
}

// Only exactly 1 and 2 count. IDs that merely go up by one don't.
const holdsEpisodes = (d) =>
  Boolean(d) && /^\d+$/.test(d.a) && /^\d+$/.test(d.b) && Number(d.a) === 1 && Number(d.b) === 2;

// The bit right before the number that belongs to the site, not the show.
const SITE_TAILS = [
  /[?&][^?&=/#]+=$/,
  /[-_/. ]*(?<![\p{L}\p{N}])(?:episode|ep|e)[-_/. ]*$/u,
  /\/$/,
];

function siteTail(prefix) {
  let best = "";
  for (const re of SITE_TAILS) {
    const m = re.exec(prefix);
    if (m && m[0].length > best.length) best = m[0];
  }
  return best;
}

const SHOW_KEYS = new Set(["id", "anime", "anime_id", "aid", "show", "series", "title", "slug", "name", "v"]);

function parseParams(query) {
  return query
    .split("&")
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf("=");
      return eq < 0 ? { key: item, value: "" } : { key: item.slice(0, eq), value: item.slice(eq + 1) };
    });
}

// Where the show name sits: a path piece or a query parameter.
function chooseShow(pieces, params) {
  const longest = (ok) => {
    let best = -1;
    pieces.forEach((piece, i) => {
      if (ok(piece) && (best < 0 || piece.length >= pieces[best].length)) best = i;
    });
    return best;
  };
  const hasLetter = (s) => /\p{L}/u.test(s);
  let i = longest((p) => hasLetter(p) && /[-_\d]/.test(p));
  if (i >= 0) return { piece: i };
  const j = params.findIndex(
    (p) => p.value && (SHOW_KEYS.has(p.key.toLowerCase()) || /\d/.test(p.value)),
  );
  if (j >= 0) return { param: j };
  i = longest(hasLetter);
  if (i >= 0) return { piece: i };
  i = longest((p) => p.length > 0);
  return i >= 0 ? { piece: i } : null;
}

function buildAddress(text, d, episodeInUrl) {
  let pieces;
  let params;
  let epParam = null;
  let tail = "";
  let token = "";
  let sufPath = "";

  if (!d) {
    const q = text.indexOf("?");
    pieces = (q < 0 ? text : text.slice(0, q)).split("/");
    params = parseParams(q < 0 ? "" : text.slice(q + 1));
  } else {
    const prefix = text.slice(0, d.p);
    const suffix = text.slice(text.length - d.s);
    const all = prefix + MARK + suffix;
    const q = all.indexOf("?");
    if (q >= 0 && q < prefix.length) {
      pieces = all.slice(0, q).split("/");
      params = parseParams(all.slice(q + 1));
      epParam = params.find((p) => p.value.includes(MARK)) ?? null;
      if (episodeInUrl && !epParam) return null;
    } else {
      tail = siteTail(prefix);
      pieces = prefix.slice(0, prefix.length - tail.length).split("/");
      const sq = suffix.indexOf("?");
      sufPath = sq < 0 ? suffix : suffix.slice(0, sq);
      params = parseParams(sq < 0 ? "" : suffix.slice(sq + 1));
      if (episodeInUrl) token = "{episode}";
      else if (d.a !== "") token = "{anything}";
    }
  }

  const others = params.filter((p) => p !== epParam);
  const show = chooseShow(pieces, others);
  if (!show) return null;
  const shaped = pieces.map((piece, i) => {
    if (i === show.piece) return "{show}";
    return /\d/.test(piece) ? "{anything}" : piece;
  });

  // Parameters that hold neither the show nor the episode are left out.
  const kept = [];
  for (const p of params) {
    if (p === epParam) {
      if (episodeInUrl) kept.push(`${p.key}=${p.value.replace(MARK, "{episode}")}`);
    } else if (show.param !== undefined && p === others[show.param]) {
      kept.push(`${p.key}={show}`);
    }
  }
  return shaped.join("/") + tail + token + sufPath + (kept.length ? "?" + kept.join("&") : "");
}

function buildTitle(first, d) {
  const before = first.slice(0, d.p).replace(/[^\p{L}\p{N}]+$/u, "");
  const word = /\p{L}+$/u.exec(before);
  if (!word) return null;
  const lead = before.slice(0, before.length - word[0].length).replace(TRAILING_SEPARATORS, "");
  if (lead) return `{show} ${word[0]} {episode}{anything}`;
  const after = first.slice(first.length - d.s).replace(LEADING_SEPARATORS, "");
  return after ? `${word[0]} {episode} {show}` : `${word[0]} {episode}{anything}`;
}

export function learnRule(first, second) {
  const ua = toHttpUrl(first?.url);
  const ub = toHttpUrl(second?.url);
  if (!ua || !ub) {
    return { ok: false, error: "I can only learn from pages whose address starts with http or https." };
  }
  const host = siteHost(ua);
  if (host !== siteHost(ub)) {
    return {
      ok: false,
      error: "Those two pages are on different sites. Open episode 2 on the same site, or start over.",
    };
  }

  const addrA = addressText(ua);
  const addrB = addressText(ub);
  const addrDiff = diff(addrA, addrB);
  const inUrl = holdsEpisodes(addrDiff);

  const titleA = String(first.title ?? "").trim();
  const titleB = String(second.title ?? "").trim();
  const titleDiff = diff(titleA, titleB);
  const title = holdsEpisodes(titleDiff) ? buildTitle(titleA, titleDiff) : null;

  const episodeFrom = inUrl ? "url" : title ? "title" : "none";
  const url = buildAddress(addrA, addrDiff, inUrl);
  if (!url) return { ok: false, error: "I couldn't find the show name in the address." };

  // The title template stays even when the address has the episode. It's a cross-check
  // and gives the show name.
  const rule = { host, url, episodeFrom };
  if (title) rule.title = title;
  return { ok: true, rule, episodeFrom };
}
