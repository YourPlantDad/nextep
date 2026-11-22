import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEpisodePage } from "../src/lib/one-click.js";
import { parseUrl } from "../src/lib/url-parser.js";

const urlOf = (address) => detectEpisodePage(address)?.rule.url;

test("a slug and ep-<n> become {show} and ep-{episode}", () => {
  const found = detectEpisodePage("https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-5");
  assert.deepEqual(found, {
    host: "example.tv",
    slug: "jujutsu-kaisen-2nd-season-78067",
    episode: 5,
    rule: { host: "example.tv", url: "/watch/{show}/ep-{episode}", episodeFrom: "url" },
  });
});

test("an episode-<n> address keeps the word episode", () => {
  assert.equal(urlOf("https://example.tv/anime/some-show-12/episode-7"), "/anime/{show}/episode-{episode}");
});

test("a path piece with a digit before the slug becomes {anything}", () => {
  assert.equal(urlOf("https://example.tv/2024/watch/some-show/ep-3"), "/{anything}/watch/{show}/ep-{episode}");
  assert.equal(urlOf("https://example.tv/v2/some-show/ep-3"), "/{anything}/{show}/ep-{episode}");
});

test("a trailing slash and a query string are dropped", () => {
  assert.equal(urlOf("https://example.tv/watch/some-show/ep-3/"), "/watch/{show}/ep-{episode}");
  assert.equal(urlOf("https://example.tv/watch/some-show/ep-3?lang=en&server=2"), "/watch/{show}/ep-{episode}");
});

test("the host loses www, and the slug is decoded and lowercased", () => {
  const found = detectEpisodePage("https://www.other.tv/Caf%C3%A9-9/ep-1");
  assert.equal(found.host, "other.tv");
  assert.equal(found.slug, "café-9");
  assert.equal(found.rule.url, "/{show}/ep-{episode}");
});

test("the rule matches the page it was built from", () => {
  for (const address of [
    "https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-5",
    "https://example.tv/2024/watch/some-show/episode-3/?x=1",
    "https://example.tv/Caf%C3%A9-9/ep-12",
  ]) {
    const { rule, slug, episode } = detectEpisodePage(address);
    const parsed = parseUrl(address, [rule]);
    assert.equal(parsed.slug, slug, address);
    assert.equal(parsed.episode, episode, address);
  }
});

test("pages that are not episode pages give null", () => {
  assert.equal(detectEpisodePage("https://example.tv/about"), null);
  assert.equal(detectEpisodePage("https://example.tv/ep-5"), null);
  assert.equal(detectEpisodePage("https://example.tv/watch/some-show/ep-0"), null);
  assert.equal(detectEpisodePage("https://example.tv/watch/some-show/ep-5x"), null);
  assert.equal(detectEpisodePage("https://example.tv/watch/some-show/trailer-5"), null);
  assert.equal(detectEpisodePage("javascript:alert(1)"), null);
  assert.equal(detectEpisodePage("not a url"), null);
});

test("a host that can never match gives null, localhost works", () => {
  assert.equal(detectEpisodePage("http://myserver/anime/some-show/ep-2"), null);
  assert.equal(detectEpisodePage("http://localhost/anime/some-show/ep-2").host, "localhost");
});
