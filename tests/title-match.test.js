import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, candidateQueries, exactMatches } from "../src/lib/title-match.js";

test("normalizeTitle handles punctuation, case and diacritics", () => {
  assert.equal(normalizeTitle("  Hunter x Hunter (2011)! "), "hunter x hunter 2011");
  assert.equal(normalizeTitle("Pokémon: The Series"), "pokemon the series");
  assert.equal(normalizeTitle("Re:Zero -- Starting Life"), "re zero starting life");
});

test("candidateQueries strips one trailing numeric token after the full form", () => {
  assert.deepEqual(candidateQueries("jujutsu-kaisen-2nd-season-78067"), [
    "jujutsu kaisen 2nd season 78067",
    "jujutsu kaisen 2nd season",
  ]);
  assert.deepEqual(candidateQueries("mob-psycho-100"), ["mob psycho 100", "mob psycho"]);
  assert.deepEqual(candidateQueries("one-piece"), ["one piece"]);
  assert.deepEqual(candidateQueries("86"), ["86"]);
});

test("candidateQueries truncates to 64 chars at a word boundary", () => {
  const slug = Array(20).fill("abcde").join("-");
  const [q] = candidateQueries(slug);
  assert.ok(q.length <= 64);
  assert.equal(q, Array(10).fill("abcde").join(" "));
  assert.ok(!q.endsWith(" "));
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
