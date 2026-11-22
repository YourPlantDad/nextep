import { test } from "node:test";
import assert from "node:assert/strict";
import { computeUpdate } from "../src/lib/progress.js";

test("not on list -> watching", () => {
  assert.deepEqual(computeUpdate({ listStatus: undefined, numEpisodes: 12, watched: 4 }), {
    body: { num_watched_episodes: 4, status: "watching" },
  });
});

test("plan_to_watch -> watching", () => {
  const listStatus = { status: "plan_to_watch", num_episodes_watched: 0 };
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 1 }).body, {
    num_watched_episodes: 1,
    status: "watching",
  });
});

test("already watching -> no status field", () => {
  const listStatus = { status: "watching", num_episodes_watched: 2 };
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 3 }), {
    body: { num_watched_episodes: 3 },
  });
});

test("final episode completes", () => {
  const listStatus = { status: "watching", num_episodes_watched: 11 };
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 12 }).body, {
    num_watched_episodes: 12,
    status: "completed",
  });
});

test("exceeds-total is skipped, even when forced", () => {
  assert.deepEqual(computeUpdate({ numEpisodes: 12, watched: 13 }), { skip: "exceeds-total" });
  assert.deepEqual(computeUpdate({ numEpisodes: 12, watched: 13, force: true }), {
    skip: "exceeds-total",
  });
});

test("not-ahead is skipped when automatic", () => {
  const listStatus = { status: "watching", num_episodes_watched: 10 };
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 5 }), { skip: "not-ahead" });
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 10 }), { skip: "not-ahead" });
});

test("forced decrease from completed goes back to watching", () => {
  const listStatus = { status: "completed", num_episodes_watched: 12 };
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 11, force: true }).body, {
    num_watched_episodes: 11,
    status: "watching",
  });
});

test("forced unchanged and invalid", () => {
  const listStatus = { status: "watching", num_episodes_watched: 5 };
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: 5, force: true }), {
    skip: "unchanged",
  });
  assert.deepEqual(computeUpdate({ listStatus, numEpisodes: 12, watched: -1, force: true }), {
    skip: "invalid",
  });
});

test("numEpisodes 0 (unknown) never completes or exceeds", () => {
  assert.deepEqual(computeUpdate({ numEpisodes: 0, watched: 500 }).body, {
    num_watched_episodes: 500,
    status: "watching",
  });
});
