import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUrl, detectGeneric, validateRules, DEFAULT_RULES } from "../src/lib/url-parser.js";

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
  assert.match(validateRules([{ host: "", pattern: "x" }]), /host/);
});

test("no rules are enabled by default", () => {
  assert.deepEqual(DEFAULT_RULES, []);
  assert.equal(parseUrl(`${BASE}/ep-4`, DEFAULT_RULES), null);
});
