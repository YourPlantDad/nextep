// Readable site templates. Literal text plus three blocks: {show}, {episode}, {anything}.
// Address templates run against the decoded path plus query. Title templates run against the tab title.

const BLOCKS = new Set(["show", "episode", "anything"]);

// Runs of these in a title template's literal text match any run of them in the title.
const TITLE_SEPARATORS = "\\s\\-\\u2013\\u2014:|\\u00b7";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tokenize(template) {
  const parts = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(template))) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ block: m[1] });
    last = re.lastIndex;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

export function toHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

// Decoded path plus query. Some sites keep a whole "?ep=1" inside an encoded path piece.
export function addressText(u) {
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it isn't valid percent-encoding.
  }
  return path + u.search;
}

export const normalizeHost = (host) => String(host).toLowerCase().replace(/^www\./, "");
export const siteHost = (u) => normalizeHost(u.hostname);

const SEP = "[" + TITLE_SEPARATORS + "]+";

function titleLiteral(text) {
  return text
    .split(new RegExp(`(${SEP})`))
    .map((piece, i) => (i % 2 === 1 ? SEP : escapeRegex(piece)))
    .join("");
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

function blockCounts(parts) {
  const counts = { show: 0, episode: 0, anything: 0 };
  for (const p of parts) if (p.block !== undefined) counts[p.block]++;
  return counts;
}

// body for one piece of template text. "show" and "anything" differ per place.
function bodyOf(parts, { show, anything, literal }) {
  let body = "";
  for (const p of parts) {
    if (p.block === "show") body += show;
    else if (p.block === "episode") body += "(?<ep>\\d+)";
    else if (p.block === "anything") body += anything;
    else body += literal(p.text);
  }
  return body;
}

// An address template is a path template plus an optional ?key=value&key=value list.
function compileUrl(template) {
  const q = template.indexOf("?");
  const pathParts = tokenize(q < 0 ? template : template.slice(0, q));
  const items = (q < 0 ? "" : template.slice(q + 1)).split("&").filter(Boolean);
  const queryParts = items.map((item) => {
    const eq = item.indexOf("=");
    return { key: eq < 0 ? item : item.slice(0, eq), value: eq < 0 ? "" : item.slice(eq + 1) };
  });
  const all = [...pathParts, ...queryParts.flatMap((p) => tokenize(p.value))];
  if (all.some((p) => p.block !== undefined && !BLOCKS.has(p.block))) return null;
  const counts = blockCounts(all);
  if (counts.show > 1 || counts.episode > 1) return null;
  if (queryParts.some((p) => p.key.includes("{"))) return null;

  // The trailing slash is always optional, so drop it from the template's own text.
  const last = pathParts[pathParts.length - 1];
  if (last?.text?.endsWith("/")) last.text = last.text.slice(0, -1);

  try {
    return {
      kind: "url",
      regex: new RegExp(
        "^" +
          bodyOf(pathParts, { show: "(?<show>[^/?#]+)", anything: "[^/]*", literal: escapeRegex }) +
          "/?$",
      ),
      params: queryParts.map((p) => ({
        key: p.key,
        regex: new RegExp(
          "^" +
            bodyOf(tokenize(p.value), {
              show: "(?<show>.+)",
              anything: ".*",
              literal: escapeRegex,
            }) +
            "$",
        ),
      })),
      hasShow: counts.show === 1,
      hasEpisode: counts.episode === 1,
    };
  } catch {
    return null;
  }
}

function compileTitle(template) {
  const parts = tokenize(template);
  if (parts.some((p) => p.block !== undefined && !BLOCKS.has(p.block))) return null;
  const counts = blockCounts(parts);
  if (counts.show > 1 || counts.episode > 1) return null;
  try {
    return {
      kind: "title",
      regex: new RegExp(
        "^" + bodyOf(parts, { show: "(?<show>.+?)", anything: ".*", literal: titleLiteral }) + "$",
        "i",
      ),
      hasShow: counts.show === 1,
      hasEpisode: counts.episode === 1,
    };
  } catch {
    return null;
  }
}

// Returns null when the template can't be compiled.
export function compileTemplate(template, kind) {
  if (typeof template !== "string") return null;
  if (kind === "url") return compileUrl(template);
  if (kind === "title") return compileTitle(template);
  return null;
}

function matchAddress(compiled, text) {
  const q = text.indexOf("?");
  const m = compiled.regex.exec(q < 0 ? text : text.slice(0, q));
  if (!m) return null;
  let show = m.groups?.show ?? null;
  let ep = m.groups?.ep ?? null;
  const given = (q < 0 ? "" : text.slice(q + 1))
    .split("&")
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf("=");
      return { key: eq < 0 ? item : item.slice(0, eq), value: safeDecode(eq < 0 ? "" : item.slice(eq + 1)) };
    });
  // Every key in the template has to be there. Order doesn't matter and extra ones are ignored.
  for (const param of compiled.params) {
    let hit = null;
    for (const g of given) {
      if (g.key === param.key && (hit = param.regex.exec(g.value))) break;
    }
    if (!hit) return null;
    show = hit.groups?.show ?? show;
    ep = hit.groups?.ep ?? ep;
  }
  return { show, ep };
}

// Returns {show, episode} (either can be null if the template has no such block), or null.
export function matchTemplate(compiled, text) {
  if (!compiled || typeof text !== "string") return null;
  const isTitle = compiled.kind === "title";
  let found;
  if (isTitle) {
    const m = compiled.regex.exec(text.trim());
    found = m && { show: m.groups?.show ?? null, ep: m.groups?.ep ?? null };
  } else {
    found = matchAddress(compiled, text);
  }
  if (!found) return null;
  let show = null;
  if (compiled.hasShow) {
    show = found.show?.trim() ?? "";
    // Sites often put "Watch " in front of the name.
    if (isTitle) show = show.replace(/^watch\s+/i, "");
    if (!show) return null;
  }
  let episode = null;
  if (compiled.hasEpisode) {
    episode = Number.parseInt(found.ep, 10);
    if (!(episode > 0)) return null;
  }
  return { show, episode };
}

// Returns an error message, or null if the template is fine.
export function validateTemplate(template, kind, { needsEpisode = false } = {}) {
  if (typeof template !== "string" || !template.trim()) return "The template is empty.";
  const counts = { show: 0, episode: 0, anything: 0 };
  for (const p of tokenize(template)) {
    if (p.block === undefined) continue;
    if (!BLOCKS.has(p.block)) {
      return `I don't know {${p.block}}. The blocks are {show}, {episode} and {anything}.`;
    }
    counts[p.block]++;
  }
  if (counts.show > 1) return "Use {show} only once.";
  if (counts.episode > 1) return "Use {episode} only once.";
  if (kind === "url" && counts.show !== 1) return "The address needs {show} once.";
  if (needsEpisode && counts.episode !== 1) return "This one needs {episode} once.";
  if (!compileTemplate(template, kind)) return "I can't read this template.";
  return null;
}
