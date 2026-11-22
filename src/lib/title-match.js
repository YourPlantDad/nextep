const MAX_QUERY = 64;

export function normalizeTitle(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// What gets sent to MyAnimeList. Long titles are cut at a word boundary, but matching
// still compares against the full text.
export function truncateQuery(s) {
  if (s.length <= MAX_QUERY) return s;
  if (s[MAX_QUERY] === " ") return s.slice(0, MAX_QUERY);
  const cut = s.slice(0, MAX_QUERY);
  const i = cut.lastIndexOf(" ");
  return i > 0 ? cut.slice(0, i) : cut;
}

// Ordered guesses for the anime's name. Only "auto" ones may be accepted without asking.
// Sites append IDs ("-78067", "-mx__ok"), but real titles can end in a number or year
// ("mob-psycho-100"), so the full slug goes first and only one piece is stripped.
export function candidateQueries(slug, titleName) {
  const words = slug.split("-").filter(Boolean);
  const list = [];
  const add = (text, auto) => {
    const key = normalizeTitle(text);
    if (key && !list.some((c) => normalizeTitle(c.text) === key)) list.push({ text, auto });
  };
  const name = String(titleName ?? "").trim();
  if (name) add(name, true);
  add(words.join(" "), true);
  if (words.length > 1 && /[\d_]/.test(words[words.length - 1])) {
    add(words.slice(0, -1).join(" "), true);
  }
  if (words.length > 2) add(words.slice(0, -2).join(" "), false);
  return list;
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

// A name from the tab title is only trusted if it shares a real word (3+ letters) with
// the address slug. Tab titles can be placeholders or belong to the previous page.
// Returns the name, or null to drop it.
export function usableTitleName(slug, titleName) {
  const name = String(titleName ?? "").trim();
  if (!name) return null;
  const slugWords = normalizeTitle(slug).split(" ");
  if (!/\p{L}/u.test(slug)) return name;
  const long = (w) => /^\p{L}{3,}$/u.test(w);
  const known = new Set(slugWords.filter(long));
  return normalizeTitle(name).split(" ").some((w) => known.has(w)) ? name : null;
}
