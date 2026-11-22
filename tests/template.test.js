import { test } from "node:test";
import assert from "node:assert/strict";
import { compileTemplate, matchTemplate, validateTemplate } from "../src/lib/template.js";

const url = (template, text) => matchTemplate(compileTemplate(template, "url"), text);
const title = (template, text) => matchTemplate(compileTemplate(template, "title"), text);

test("address template with show and episode", () => {
  assert.deepEqual(url("/watch/{show}/ep-{episode}", "/watch/some-show-12/ep-4"), {
    show: "some-show-12",
    episode: 4,
  });
  assert.equal(url("/watch/{show}/ep-{episode}", "/watch/some-show-12/ep-0"), null);
  assert.equal(url("/watch/{show}/ep-{episode}", "/other/some-show-12/ep-4"), null);
});

test("address template is anchored at both ends", () => {
  assert.equal(url("/watch/{show}/ep-{episode}", "/x/watch/a/ep-1"), null);
  assert.equal(url("/watch/{show}/ep-{episode}", "/watch/a/ep-1/more"), null);
});

test("trailing slash is optional", () => {
  assert.equal(url("/{show}-episode-{episode}/", "/a-b-episode-3").episode, 3);
  assert.equal(url("/{show}-episode-{episode}/", "/a-b-episode-3/").episode, 3);
  assert.equal(url("/watch/{show}/{episode}", "/watch/a/3/").episode, 3);
});

test("a template without ? allows any query string", () => {
  assert.equal(url("/watch/{show}/{episode}", "/watch/a/3?x=1&y=2").episode, 3);
});

test("a template with ? allows extra & parameters", () => {
  const t = "/watch/{show}?ep={episode}";
  assert.deepEqual(url(t, "/watch/a?ep=7"), { show: "a", episode: 7 });
  assert.equal(url(t, "/watch/a?ep=7&lang=en").episode, 7);
  assert.equal(url(t, "/watch/a?other=7"), null);
});

test("{anything} stays inside one path piece", () => {
  assert.equal(url("/watch/{anything}/{show}", "/watch/21/one-piece").show, "one-piece");
  assert.equal(url("/watch/{anything}/{show}", "/watch/21/22/one-piece"), null);
});

test("show and episode are null when the template lacks the block", () => {
  assert.deepEqual(url("/watch/{show}", "/watch/a"), { show: "a", episode: null });
  assert.deepEqual(title("Episode {episode}", "Episode 5"), { show: null, episode: 5 });
});

test("literal text is escaped", () => {
  assert.equal(url("/a.b/{show}", "/axb/c"), null);
  assert.equal(url("/a.b/{show}", "/a.b/c").show, "c");
});

test("title template matches case-insensitively", () => {
  assert.deepEqual(title("{show} episode {episode}", "Some Show EPISODE 2"), {
    show: "Some Show",
    episode: 2,
  });
});

test("title separators match any run of separators", () => {
  const t = "{show} Episode {episode}{anything}";
  assert.deepEqual(title(t, "Some Show Episode 2 English SUB at ExampleSite"), {
    show: "Some Show",
    episode: 2,
  });
  assert.deepEqual(title(t, "Some Show - Episode 2"), { show: "Some Show", episode: 2 });
  assert.deepEqual(title(t, "Some Show \u2014 Episode 12"), { show: "Some Show", episode: 12 });
  assert.deepEqual(title(t, "Some Show | Episode 3"), { show: "Some Show", episode: 3 });
  assert.equal(title(t, "Now playing · ExampleSite"), null);
});

test("invalid templates compile to null and never match", () => {
  assert.equal(compileTemplate("/{nope}", "url"), null);
  assert.equal(compileTemplate("/{show}/{show}", "url"), null);
  assert.equal(matchTemplate(null, "x"), null);
});

test("validateTemplate for addresses", () => {
  assert.equal(validateTemplate("/watch/{show}/ep-{episode}", "url", { needsEpisode: true }), null);
  assert.match(validateTemplate("/watch/ep-{episode}", "url"), /show/);
  assert.match(validateTemplate("/{show}/{show}", "url"), /only once/);
  assert.match(validateTemplate("/{show}/{episode}/{episode}", "url"), /only once/);
  assert.match(validateTemplate("/{show}/{nope}", "url"), /nope/);
  assert.match(validateTemplate("/{show}", "url", { needsEpisode: true }), /episode/);
  assert.match(validateTemplate("", "url"), /empty/);
});

test("validateTemplate for titles", () => {
  assert.equal(
    validateTemplate("{show} Episode {episode}{anything}", "title", { needsEpisode: true }),
    null,
  );
  assert.equal(validateTemplate("Episode {episode}", "title", { needsEpisode: true }), null);
  assert.match(validateTemplate("{show} Episode", "title", { needsEpisode: true }), /episode/);
  assert.match(validateTemplate("{x}", "title"), /x/);
});

test("query parameters match in any order and extra ones are ignored", () => {
  const t = "/anime/watch?id={show}&ep={episode}";
  assert.deepEqual(url(t, "/anime/watch?id=21&ep=1&lang=hindi&svr=igris"), { show: "21", episode: 1 });
  assert.deepEqual(url(t, "/anime/watch?lang=hindi&ep=2&src=a&id=14"), { show: "14", episode: 2 });
  assert.equal(url(t, "/anime/watch?id=21"), null);
  assert.equal(url(t, "/anime/watch?ep=1"), null);
  assert.equal(url(t, "/anime/other?id=21&ep=1"), null);
});

test("a parameter value can mix literal text and a block", () => {
  assert.deepEqual(url("/w?id={show}&e=ep-{episode}", "/w?e=ep-7&id=a"), { show: "a", episode: 7 });
  assert.equal(url("/w?id={show}&e=ep-{episode}", "/w?e=7&id=a"), null);
  assert.equal(url("/w?id={show}&lang=hindi", "/w?id=a&lang=english"), null);
  assert.equal(url("/w?id={show}&lang=hindi", "/w?id=a&lang=hindi").show, "a");
});

test("parameter values are percent-decoded and the path may hold an encoded query", () => {
  assert.equal(url("/w?name={show}", "/w?name=one%20piece").show, "one piece");
  assert.deepEqual(url("/watch/{anything}/{show}", "/watch/21/one-piece-1?ep=2"), {
    show: "one-piece-1",
    episode: null,
  });
});

test("the title show name loses a leading Watch", () => {
  assert.equal(title("{show} Episode {episode}", "Watch ONE PIECE Episode 1").show, "ONE PIECE");
  assert.equal(title("{show} Episode {episode}", "watching Foo Episode 1").show, "watching Foo");
});

test("a title template can put the show after the number", () => {
  assert.deepEqual(title("Episode {episode} {show}", "Episode 2 - Dragon Ball Super"), {
    show: "Dragon Ball Super",
    episode: 2,
  });
  assert.equal(title("Episode {episode} {show}", "Watch Episode 1 of Anime - SiteI"), null);
});

test("a block inside a parameter name can't be compiled", () => {
  assert.equal(compileTemplate("/w?{show}=1", "url"), null);
});
