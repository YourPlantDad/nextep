import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTitle,
  candidateQueries,
  exactMatches,
  truncateQuery,
  usableTitleName,
} from "../src/lib/title-match.js";

test("normalizeTitle handles punctuation, case and diacritics", () => {
  assert.equal(normalizeTitle("  Hunter x Hunter (2011)! "), "hunter x hunter 2011");
  assert.equal(normalizeTitle("Pokémon: The Series"), "pokemon the series");
  assert.equal(normalizeTitle("Re:Zero -- Starting Life"), "re zero starting life");
});

const texts = (list) => list.map((c) => c.text);

test("candidateQueries goes full slug first, then drops an ID-like last piece", () => {
  assert.deepEqual(candidateQueries("jujutsu-kaisen-2nd-season-78067"), [
    { text: "jujutsu kaisen 2nd season 78067", auto: true },
    { text: "jujutsu kaisen 2nd season", auto: true },
    { text: "jujutsu kaisen 2nd", auto: false },
  ]);
  assert.deepEqual(candidateQueries("mob-psycho-100"), [
    { text: "mob psycho 100", auto: true },
    { text: "mob psycho", auto: true },
    { text: "mob", auto: false },
  ]);
  assert.deepEqual(candidateQueries("one-piece"), [{ text: "one piece", auto: true }]);
  assert.deepEqual(candidateQueries("86"), [{ text: "86", auto: true }]);
});

test("candidateQueries drops pieces with a digit or an underscore, not plain words", () => {
  assert.deepEqual(texts(candidateQueries("jojo-no-kimyou-na-bouken-tv-mx__ok")), [
    "jojo no kimyou na bouken tv mx__ok",
    "jojo no kimyou na bouken tv",
    "jojo no kimyou na bouken",
  ]);
  assert.deepEqual(texts(candidateQueries("some-show-42t9i1")), [
    "some show 42t9i1",
    "some show",
    "some",
  ]);
  assert.deepEqual(texts(candidateQueries("some-show-final")), [
    "some show final",
    "some",
  ]);
});

test("candidateQueries puts the title name first and skips duplicates", () => {
  const list = candidateQueries("some-show-12", "Some Show");
  assert.deepEqual(list, [
    { text: "Some Show", auto: true },
    { text: "some show 12", auto: true },
    { text: "some", auto: false },
  ]);
  assert.deepEqual(texts(candidateQueries("some-show", "Some  Show")), ["Some  Show"]);
});

test("truncateQuery cuts to 64 chars at a word boundary", () => {
  const long = Array(20).fill("abcde").join(" ");
  const q = truncateQuery(long);
  assert.ok(q.length <= 64);
  assert.equal(q, Array(10).fill("abcde").join(" "));
  assert.equal(truncateQuery("short"), "short");
  assert.equal(truncateQuery("a".repeat(70)), "a".repeat(64));
});

test("candidateQueries keeps the full text for long titles", () => {
  const slug = Array(20).fill("abcde").join("-");
  const [first] = candidateQueries(slug);
  assert.equal(first.text, Array(20).fill("abcde").join(" "));
});

test("exactMatches via title, en and synonyms", () => {
  const nodes = [
    { id: 1, title: "Shingeki no Kyojin" },
    { id: 2, title: "X", alternative_titles: { en: "Attack on Titan", synonyms: [] } },
    { id: 3, title: "Y", alternative_titles: { en: "", synonyms: ["AoT!"] } },
    { id: 4, title: "Unrelated" },
  ];
  assert.deepEqual(exactMatches("shingeki no kyojin", nodes).map((n) => n.id), [1]);
  assert.deepEqual(exactMatches("attack-on titan", nodes).map((n) => n.id), [2]);
  assert.deepEqual(exactMatches("aot", nodes).map((n) => n.id), [3]);
});

test("exactMatches returns several nodes when several match", () => {
  const nodes = [
    { id: 1, title: "Foo" },
    { id: 2, title: "X", alternative_titles: { synonyms: ["foo"] } },
  ];
  assert.equal(exactMatches("Foo", nodes).length, 2);
});

test("usableTitleName needs a shared word of 3+ letters with the slug", () => {
  assert.equal(usableTitleName("one-piece-21", "ONE PIECE"), "ONE PIECE");
  assert.equal(usableTitleName("one-piece-21", "Attack on Titan"), null);
  assert.equal(usableTitleName("attack-on-titan-dual-audio-25", "Attack on Titan English Sub"), "Attack on Titan English Sub");
  assert.equal(usableTitleName("14", "Dragon Ball Super"), "Dragon Ball Super");
  assert.equal(usableTitleName("on-it-5", "On It"), null);
  assert.equal(usableTitleName("one-piece", "  "), null);
});
