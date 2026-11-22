import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUrl,
  parseTab,
  visitTrigger,
  pickEpisode,
  hostHasRule,
  detectGeneric,
  validateRules,
  DEFAULT_RULES,
} from "../src/lib/url-parser.js";

const RULES = [{ host: "example.tv", pattern: "^/watch/(?<slug>[^/]+)/ep-(?<ep>\\d+)" }];
const BASE = "https://example.tv/watch/jujutsu-kaisen-2nd-season-78067";

test("example.tv episodes: same key, different episode", () => {
  const a = parseUrl(`${BASE}/ep-4`, RULES);
  const b = parseUrl(`${BASE}/ep-5`, RULES);
  assert.equal(a.episode, 4);
  assert.equal(b.episode, 5);
  assert.equal(a.key, b.key);
  assert.deepEqual(a, {
    host: "example.tv",
    slug: "jujutsu-kaisen-2nd-season-78067",
    episode: 4,
    key: "example.tv|jujutsu-kaisen-2nd-season-78067",
    urlEpisode: 4,
    titleEpisode: null,
    titleName: null,
    hasTitleTemplate: false,
    source: "url",
  });
});

test("subdomain host matches", () => {
  assert.equal(parseUrl("https://www.example.tv/watch/x-1/ep-2", RULES).episode, 2);
});

test("non-matching host and lookalike host are rejected", () => {
  assert.equal(parseUrl("https://example.com/watch/x-1/ep-2", RULES), null);
  assert.equal(parseUrl("https://notexample.tv/watch/x-1/ep-2", RULES), null);
});

test("invalid URL, non-http scheme, ep 0 return null", () => {
  assert.equal(parseUrl("not a url", RULES), null);
  assert.equal(parseUrl("ftp://example.tv/watch/x-1/ep-2", RULES), null);
  assert.equal(parseUrl("https://example.tv/watch/x-1/ep-0", RULES), null);
});

test("invalid regex in a rule returns null without throwing", () => {
  assert.equal(parseUrl("https://a.tv/x/ep-1", [{ host: "a.tv", pattern: "(" }]), null);
});

test("slug is URI-decoded and lowercased", () => {
  const r = parseUrl("https://example.tv/watch/Caf%C3%A9-9/ep-1", RULES);
  assert.equal(r.slug, "café-9");
});

test("pattern is matched against the query string", () => {
  const rules = [{ host: "s.tv", pattern: "^/player\\?show=(?<slug>[^&]+)&ep=(?<ep>\\d+)" }];
  const r = parseUrl("https://s.tv/player?show=Bleach&ep=12", rules);
  assert.equal(r.slug, "bleach");
  assert.equal(r.episode, 12);
});

test("detectGeneric works on any host and strips www", () => {
  const r = detectGeneric("https://www.other.tv/anime/some-show-12/episode-7");
  assert.deepEqual(r, { host: "other.tv", slug: "some-show-12", episode: 7 });
  assert.equal(detectGeneric("https://other.tv/about"), null);
  assert.equal(detectGeneric("javascript:alert(1)"), null);
});

test("validateRules", () => {
  assert.equal(validateRules(RULES), null);
  assert.match(validateRules([{ host: "a.tv", pattern: "(" }]), /invalid pattern/);
  assert.match(validateRules([{ host: "a.tv", pattern: "(?<slug>x)" }]), /groups/);
  assert.match(validateRules([{ host: "", pattern: "x" }]), /website/);
});

const TEMPLATE_URL = {
  host: "example.tv",
  url: "/watch/{show}/ep-{episode}",
  episodeFrom: "url",
};
const TEMPLATE_TITLE = {
  host: "example.tv",
  url: "/watch/{show}?ep={anything}",
  title: "{show} Episode {episode}{anything}",
  episodeFrom: "title",
};
const TEMPLATE_NONE = { host: "example.tv", url: "/watch/{anything}/{show}", episodeFrom: "none" };

test("parseTab with an address template", () => {
  const r = parseTab({ url: "https://example.tv/watch/Some-Show-9/ep-3", title: "x" }, [TEMPLATE_URL]);
  assert.deepEqual(r, {
    host: "example.tv",
    slug: "some-show-9",
    episode: 3,
    key: "example.tv|some-show-9",
    urlEpisode: 3,
    titleEpisode: null,
    titleName: null,
    hasTitleTemplate: false,
    source: "url",
  });
});

test("parseTab with an episode from the title", () => {
  const url = "https://example.tv/watch/some-show-9?ep=1234";
  const hit = parseTab({ url, title: "Some Show Episode 5 at ExampleSite" }, [TEMPLATE_TITLE]);
  assert.equal(hit.episode, 5);
  assert.equal(hit.source, "title");
  assert.equal(hit.titleName, "Some Show");
  assert.equal(hit.slug, "some-show-9");
  const miss = parseTab({ url, title: "Loading" }, [TEMPLATE_TITLE]);
  assert.equal(miss.episode, null);
  assert.equal(miss.titleName, null);
  assert.equal(miss.source, "title");
});

test("parseTab with no episode source", () => {
  const r = parseTab({ url: "https://example.tv/watch/21/some-show-9", title: "" }, [TEMPLATE_NONE]);
  assert.equal(r.episode, null);
  assert.equal(r.source, "none");
  assert.equal(r.slug, "some-show-9");
});

test("parseTab accepts old and new rules together and never throws", () => {
  const rules = [RULES[0], TEMPLATE_TITLE, { host: "example.tv", url: "/{nope}", episodeFrom: "url" }, null];
  assert.equal(parseTab({ url: "https://example.tv/watch/a-1/ep-2" }, rules).source, "url");
  assert.equal(parseTab({ url: "https://example.tv/watch/a-1?ep=9", title: "A Episode 2" }, rules).episode, 2);
  assert.equal(parseTab({ url: "https://example.tv/elsewhere" }, rules), null);
  assert.equal(parseTab(undefined, rules), null);
  assert.equal(parseTab({ url: "https://example.tv/watch/a-1/ep-2" }, null), null);
});

test("hostHasRule follows host matching", () => {
  assert.equal(hostHasRule("https://www.example.tv/anything", RULES), true);
  assert.equal(hostHasRule("https://notexample.tv/anything", RULES), false);
  assert.equal(hostHasRule("nope", RULES), false);
});

test("visitTrigger", () => {
  const parsed = { source: "url", episode: 2 };
  assert.equal(visitTrigger(parsed, { url: "https://example.tv/x" }), "url");
  assert.equal(visitTrigger(parsed, { title: "t" }), "title");
  assert.equal(visitTrigger(parsed, { status: "complete" }), "title");
  assert.equal(visitTrigger(parsed, { url: "https://example.tv/x", status: "complete" }), "title");
  assert.equal(visitTrigger(parsed, { status: "loading" }), null);
  assert.equal(visitTrigger(parsed, {}), null);
  assert.equal(visitTrigger(null, { url: "u" }), null);
});

test("parseTab keeps both episode numbers", () => {
  const rule = {
    host: "h.example",
    url: "/watch/{show}?ep={episode}",
    title: "{show} Episode {episode}{anything}",
    episodeFrom: "url",
  };
  const r = parseTab(
    { url: "https://h.example/watch/one-piece-1?ep=150093", title: "One Piece Episode 2 | SiteH" },
    [rule],
  );
  assert.equal(r.episode, 150093);
  assert.equal(r.urlEpisode, 150093);
  assert.equal(r.titleEpisode, 2);
  assert.equal(r.titleName, "One Piece");
  assert.equal(r.hasTitleTemplate, true);
  const t = parseTab(
    { url: "https://h.example/watch/one-piece-1?ep=150093", title: "One Piece Episode 2 | SiteH" },
    [{ ...rule, episodeFrom: "title" }],
  );
  assert.equal(t.episode, 2);
});

test("pickEpisode lets the title win only when the address number can't be an episode", () => {
  const base = { source: "url", urlEpisode: 5, titleEpisode: 4 };
  assert.deepEqual(pickEpisode(base, 23), { episode: 5, fromTitle: false });
  assert.deepEqual(pickEpisode({ ...base, urlEpisode: 150093, titleEpisode: 2 }, 13), {
    episode: 2,
    fromTitle: true,
  });
  assert.deepEqual(pickEpisode({ ...base, urlEpisode: 150093, titleEpisode: 2 }, 0), {
    episode: 2,
    fromTitle: true,
  });
  assert.deepEqual(pickEpisode({ ...base, urlEpisode: 1500, titleEpisode: 2 }, 0), {
    episode: 1500,
    fromTitle: false,
  });
  assert.deepEqual(pickEpisode({ ...base, urlEpisode: 30, titleEpisode: 40 }, 23), {
    episode: 30,
    fromTitle: false,
  });
  // The address number can't be an episode and the title has none: unknown, not a guess.
  const withTemplate = { ...base, urlEpisode: 149945, titleEpisode: null, hasTitleTemplate: true };
  for (const total of [13, 0]) {
    assert.deepEqual(pickEpisode(withTemplate, total), { episode: null, fromTitle: true });
  }
  // Without a title template the address number stays, for sites that number differently.
  const noTemplate = { ...withTemplate, hasTitleTemplate: false };
  for (const total of [13, 0]) {
    assert.deepEqual(pickEpisode(noTemplate, total), { episode: 149945, fromTitle: false });
  }
  assert.deepEqual(pickEpisode({ source: "title", titleEpisode: null }, 5), {
    episode: null,
    fromTitle: true,
  });
  assert.deepEqual(pickEpisode({ source: "none" }, 5), { episode: null, fromTitle: false });
});

test("validateRules for template rules", () => {
  assert.equal(validateRules([TEMPLATE_URL, TEMPLATE_TITLE, TEMPLATE_NONE]), null);
  assert.match(validateRules([{ ...TEMPLATE_URL, episodeFrom: "maybe" }]), /episode number comes from/);
  assert.match(validateRules([{ ...TEMPLATE_URL, url: "/watch/ep-{episode}" }]), /show/);
  assert.match(validateRules([{ ...TEMPLATE_URL, url: "/watch/{show}" }]), /episode/);
  assert.match(validateRules([{ ...TEMPLATE_TITLE, title: "" }]), /tab title/);
  assert.match(validateRules([{ ...TEMPLATE_TITLE, title: "{show} Episode" }]), /episode/);
  assert.match(validateRules([{ ...TEMPLATE_NONE, title: "{show} {what}" }]), /what/);
});

test("no rules are enabled by default", () => {
  assert.deepEqual(DEFAULT_RULES, []);
  assert.equal(parseUrl(`${BASE}/ep-4`, DEFAULT_RULES), null);
});
