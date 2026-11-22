// The one-click "Enable on <host>": spots addresses like /<slug>/ep-<n> or /<slug>/episode-<n>
// and builds a site rule from the address alone.
import { toHttpUrl, addressText, siteHost, isHostname, validateTemplate } from "./template.js";

const EPISODE_PIECE = /^(ep|episode)-(\d+)$/;

// Returns { host, slug, episode, rule } or null. rule is {host, url, episodeFrom: "url"}.
// The slug piece becomes {show}, the number {episode}, and the ep- or episode- stays. Other path
// pieces stay as they are, or become {anything} if they have a digit. The query is dropped.
export function detectEpisodePage(url) {
  const u = toHttpUrl(url);
  if (!u) return null;
  const host = siteHost(u);
  if (!isHostname(host)) return null;

  // Same decoding as the template matcher, but without the query.
  const pieces = addressText(new URL(u.pathname, u.origin)).split("/");
  if (pieces.length > 2 && pieces.at(-1) === "") pieces.pop();
  const at = pieces.findIndex((piece, i) => i > 1 && pieces[i - 1] !== "" && EPISODE_PIECE.test(piece));
  if (at < 0) return null;

  const [, prefix, digits] = EPISODE_PIECE.exec(pieces[at]);
  const episode = Number.parseInt(digits, 10);
  if (!(episode > 0)) return null;
  // A piece with braces or a question mark would break the template.
  if (pieces.some((piece) => /[{}?]/.test(piece))) return null;

  const template = pieces
    .map((piece, i) => {
      if (i === at - 1) return "{show}";
      if (i === at) return `${prefix}-{episode}`;
      return /\d/.test(piece) ? "{anything}" : piece;
    })
    .join("/");
  if (validateTemplate(template, "url", { needsEpisode: true })) return null;

  return {
    host,
    slug: pieces[at - 1].toLowerCase(),
    episode,
    rule: { host, url: template, episodeFrom: "url" },
  };
}
