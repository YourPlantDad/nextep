import {
  compileTemplate,
  matchTemplate,
  validateTemplate,
  toHttpUrl,
  addressText,
  siteHost,
} from "./template.js";

export const DEFAULT_RULES = [];
export const EPISODE_SOURCES = ["url", "title", "none"];

export const GENERIC_PATTERN = "/(?<slug>[^/]+)/(?:ep|episode)-(?<ep>\\d+)";

// The old kind of rule: a regex tested against the raw path plus query.
function extractPattern(u, pattern) {
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

function extractTemplate(u, title, rule) {
  const found = matchTemplate(compileTemplate(rule.url, "url"), addressText(u));
  if (!found?.show) return null;
  const hasTitleTemplate = typeof rule.title === "string" && rule.title.trim() !== "";
  const fromTitle = hasTitleTemplate
    ? matchTemplate(compileTemplate(rule.title, "title"), title)
    : null;
  const source = EPISODE_SOURCES.includes(rule.episodeFrom) ? rule.episodeFrom : "none";
  const urlEpisode = found.episode;
  const titleEpisode = fromTitle?.episode ?? null;
  if (source === "url" && urlEpisode === null) return null;
  return {
    slug: found.show.toLowerCase(),
    episode: source === "url" ? urlEpisode : source === "title" ? titleEpisode : null,
    urlEpisode,
    titleEpisode,
    titleName: fromTitle?.show ?? null,
    hasTitleTemplate,
    source,
  };
}

function extractRule(u, title, rule) {
  if (typeof rule.url === "string") return extractTemplate(u, title, rule);
  const found = extractPattern(u, rule.pattern);
  return (
    found && {
      ...found,
      urlEpisode: found.episode,
      titleEpisode: null,
      titleName: null,
      hasTitleTemplate: false,
      source: "url",
    }
  );
}

// Never throws. Rules can be the old {host, pattern} or the newer {host, url, title?, episodeFrom}.
// episode is the number from the rule's own source. Both numbers are kept so a caller can cross-check.
export function parseTab(tab, rules) {
  try {
    const u = toHttpUrl(tab?.url);
    if (!u) return null;
    const title = typeof tab.title === "string" ? tab.title : "";
    for (const rule of rules ?? []) {
      if (typeof rule?.host !== "string" || !hostMatches(u.hostname, rule.host)) continue;
      const found = extractRule(u, title, rule);
      if (found) return { host: rule.host, ...found, key: rule.host + "|" + found.slug };
    }
  } catch {
    // A broken rule or odd tab data just means no match.
  }
  return null;
}

export const parseUrl = (url, rules) => parseTab({ url }, rules);

export function hostHasRule(url, rules) {
  const u = toHttpUrl(url);
  if (!u) return false;
  return (rules ?? []).some((r) => typeof r?.host === "string" && hostMatches(u.hostname, r.host));
}

// What kind of tab update this is. A bare URL change is "url". The title is still the
// previous page's at that moment, so title rules wait for "title".
export function visitTrigger(parsed, changeInfo) {
  if (!parsed) return null;
  if (changeInfo?.title !== undefined || changeInfo?.status === "complete") return "title";
  if (changeInfo?.url) return "url";
  return null;
}

// Which episode number to trust. A URL number that can't be an episode (it's past the
// total, or past 2000 when the total isn't known) loses to a title number that can be.
export function pickEpisode(parsed, total = 0) {
  if (!parsed) return { episode: null, fromTitle: false };
  if (parsed.source === "title") return { episode: parsed.titleEpisode, fromTitle: true };
  if (parsed.source !== "url") return { episode: null, fromTitle: false };
  const { urlEpisode: url, titleEpisode: title } = parsed;
  const limit = total > 0 ? total : 2000;
  if (title !== null && title !== url && url > limit && title <= limit) {
    return { episode: title, fromTitle: true };
  }
  return { episode: url, fromTitle: false };
}

export function detectGeneric(url) {
  const u = toHttpUrl(url);
  if (!u) return null;
  const found = extractPattern(u, GENERIC_PATTERN);
  if (!found) return null;
  return { host: siteHost(u), ...found };
}

function validateTemplateRule(rule, label) {
  if (!EPISODE_SOURCES.includes(rule.episodeFrom)) {
    return `${label}: pick where the episode number comes from.`;
  }
  const urlProblem = validateTemplate(rule.url, "url", { needsEpisode: rule.episodeFrom === "url" });
  if (urlProblem) return `${label}: address. ${urlProblem}`;
  const hasTitle = typeof rule.title === "string" && rule.title.trim() !== "";
  if (rule.episodeFrom === "title" && !hasTitle) {
    return `${label}: I need a tab title template when the episode number comes from the tab title.`;
  }
  if (hasTitle) {
    const titleProblem = validateTemplate(rule.title, "title", {
      needsEpisode: rule.episodeFrom === "title",
    });
    if (titleProblem) return `${label}: tab title. ${titleProblem}`;
  }
  return null;
}

// Returns an error message, or null if every rule works.
export function validateRules(rules) {
  if (!Array.isArray(rules)) return "Site rules must be a list.";
  for (const rule of rules) {
    const label = rule?.host || "(no host)";
    if (typeof rule?.host !== "string" || !rule.host.trim()) {
      return "Every site rule needs a host.";
    }
    if (rule.url !== undefined) {
      const problem = validateTemplateRule(rule, label);
      if (problem) return problem;
      continue;
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
