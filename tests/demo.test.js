import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHOWS, showBySlug, pageTitle, episodeAddress } from "../docs/shows.js";
import { detectEpisodePage } from "../src/lib/one-click.js";
import { learnRule } from "../src/lib/learn.js";
import { parseTab } from "../src/lib/url-parser.js";

const BASE = "https://yourplantdad.github.io/nextep/";
const deathParade = showBySlug("death-parade");
const bebop = showBySlug("cowboy-bebop-1");

const page = (show, episode) => ({
  url: BASE + episodeAddress(show, episode),
  title: pageTitle(show, episode),
});

const docsFile = (path) => fileURLToPath(new URL(`../docs/${path}`, import.meta.url));

test("the one-click enable reads the address of a shape A page", () => {
  const found = detectEpisodePage(page(deathParade, 1).url);
  assert.equal(found.host, "yourplantdad.github.io");
  assert.equal(found.slug, "death-parade");
  assert.equal(found.episode, 1);
  assert.equal(found.rule.url, "/nextep/watch/{show}/ep-{episode}");
});

test("teaching with shape A takes the episode from the address", () => {
  const r = learnRule(page(deathParade, 1), page(deathParade, 2));
  assert.equal(r.ok, true);
  assert.equal(r.episodeFrom, "url");
});

test("teaching with shape B takes the episode from the tab title", () => {
  const r = learnRule(page(bebop, 1), page(bebop, 2));
  assert.equal(r.ok, true);
  assert.equal(r.episodeFrom, "title");

  const parsed = parseTab(page(bebop, 5), [r.rule]);
  assert.equal(parsed.slug, "cowboy-bebop-1");
  assert.equal(parsed.titleEpisode, 5);
  assert.equal(parsed.episode, 5);
  assert.equal(parsed.titleName, "Cowboy Bebop");
});

test("every shape A page file exists and they are all the same", () => {
  const files = Array.from({ length: deathParade.total }, (_, i) =>
    docsFile(`watch/death-parade/ep-${i + 1}/index.html`),
  );
  for (const file of files) assert.ok(existsSync(file), file);
  const first = readFileSync(files[0]);
  for (const file of files) assert.deepEqual(readFileSync(file), first, file);
});

test("the shape B page file exists", () => {
  assert.ok(existsSync(docsFile("player/cowboy-bebop-1/index.html")));
});

test("both shows are known", () => {
  assert.deepEqual(SHOWS.map((s) => s.slug), ["death-parade", "cowboy-bebop-1"]);
});
