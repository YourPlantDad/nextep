const MAX_QUERY = 64;

export function normalizeTitle(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function truncate(s) {
  if (s.length <= MAX_QUERY) return s;
  if (s[MAX_QUERY] === " ") return s.slice(0, MAX_QUERY);
  const cut = s.slice(0, MAX_QUERY);
  const i = cut.lastIndexOf(" ");
  return i > 0 ? cut.slice(0, i) : cut;
}

// Sites append a numeric ID, but real titles can end in a number or year
// ("mob-psycho-100"), so the full form goes first and only one token is stripped.
export function candidateQueries(slug) {
  const words = slug.split("-").filter(Boolean);
  const full = words.join(" ");
  if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) {
    return [full, words.slice(0, -1).join(" ")].map(truncate);
  }
  return [truncate(full)];
}

export function exactMatches(query, nodes) {
  const wanted = normalizeTitle(query);
  return nodes.filter((n) => {
    const alt = n.alternative_titles ?? {};
    return [n.title, alt.en, ...(alt.synonyms ?? [])].some(
      (t) => t && normalizeTitle(t) === wanted,
    );
  });
}
