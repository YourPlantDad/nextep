export const DEFAULT_RULES = [];

export const GENERIC_PATTERN = "/(?<slug>[^/]+)/(?:ep|episode)-(?<ep>\\d+)";

function toHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function extract(u, pattern) {
  let m;
  try {
    m = new RegExp(pattern).exec(u.pathname + u.search);
  } catch {
    return null;
  }
  const rawSlug = m?.groups?.slug;
  const episode = Number.parseInt(m?.groups?.ep, 10);
  if (!rawSlug || !(episode > 0)) return null;
  try {
    return { slug: decodeURIComponent(rawSlug).toLowerCase(), episode };
  } catch {
    return null;
  }
}

function hostMatches(hostname, host) {
  const h = hostname.toLowerCase();
  const r = host.toLowerCase();
  return h === r || h.endsWith("." + r);
}

export function parseUrl(url, rules) {
  const u = toHttpUrl(url);
  if (!u) return null;
  for (const rule of rules ?? []) {
    if (!hostMatches(u.hostname, rule.host)) continue;
    const found = extract(u, rule.pattern);
    if (found) {
      return { host: rule.host, ...found, key: rule.host + "|" + found.slug };
    }
  }
  return null;
}

export function detectGeneric(url) {
  const u = toHttpUrl(url);
  if (!u) return null;
  const found = extract(u, GENERIC_PATTERN);
  if (!found) return null;
  return { host: u.hostname.replace(/^www\./, ""), ...found };
}

// Returns an error message, or null if every rule works.
export function validateRules(rules) {
  if (!Array.isArray(rules)) return "Site rules must be a list.";
  for (const rule of rules) {
    const label = rule?.host || "(no host)";
    if (typeof rule?.host !== "string" || !rule.host.trim()) {
      return "Every site rule needs a host.";
    }
    if (typeof rule.pattern !== "string") return `${label}: pattern is missing.`;
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      return `${label}: invalid pattern (${e.message}).`;
    }
    if (!rule.pattern.includes("(?<slug>") || !rule.pattern.includes("(?<ep>")) {
      return `${label}: pattern needs both (?<slug>...) and (?<ep>...) groups.`;
    }
  }
  return null;
}
