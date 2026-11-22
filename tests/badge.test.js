import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeText } from "../src/lib/badge.js";

const parsed = { key: "example.tv|some-show" };
const mapping = (extra = {}) => ({
  malId: 1,
  confirmed: true,
  numEpisodes: 12,
  ...extra,
});
const badge = (args) =>
  badgeText({ signedIn: true, parsed, mapping: mapping(), episode: 3, ...args });

test("no tracked page gives an empty badge, even when signed out", () => {
  assert.equal(badge({ parsed: null }), "");
  assert.equal(badge({ parsed: null, signedIn: false }), "");
});

test("signed out shows !", () => {
  assert.equal(badge({ signedIn: false }), "!");
});

test("no mapping, unconfirmed or no anime id shows ?", () => {
  assert.equal(badge({ mapping: null }), "?");
  assert.equal(badge({ mapping: mapping({ confirmed: false }) }), "?");
  assert.equal(badge({ mapping: mapping({ malId: null }) }), "?");
});

test("paused shows II", () => {
  assert.equal(badge({ mapping: mapping({ paused: "on_hold" }) }), "II");
  assert.equal(badge({ mapping: mapping({ paused: "dropped" }) }), "II");
});

test("last episode and not completed shows end", () => {
  assert.equal(badge({ episode: 12 }), "end");
  const listStatus = { status: "watching", watched: 11 };
  assert.equal(badge({ episode: 12, mapping: mapping({ listStatus }) }), "end");
});

test("empty when completed, not the last episode, or the total is unknown", () => {
  const listStatus = { status: "completed", watched: 12 };
  assert.equal(badge({ episode: 12, mapping: mapping({ listStatus }) }), "");
  assert.equal(badge({ episode: 11 }), "");
  assert.equal(badge({ episode: null }), "");
  assert.equal(badge({ episode: 0, mapping: mapping({ numEpisodes: 0 }) }), "");
});

test("priority is !, ?, II, end", () => {
  const paused = mapping({ paused: "on_hold" });
  assert.equal(badge({ signedIn: false, mapping: null, episode: 12 }), "!");
  assert.equal(badge({ mapping: { ...paused, confirmed: false }, episode: 12 }), "?");
  assert.equal(badge({ mapping: paused, episode: 12 }), "II");
});
