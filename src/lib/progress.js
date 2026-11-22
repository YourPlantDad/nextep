export const PAUSED_STATUSES = ["on_hold", "dropped"];
export const LIST_STATUSES = ["watching", "completed", "on_hold", "dropped", "plan_to_watch"];

export const isPaused = (status) => PAUSED_STATUSES.includes(status);

// MAL names this field differently per direction: responses use num_episodes_watched,
// the PATCH body uses num_watched_episodes.
export function computeUpdate({ listStatus, numEpisodes, watched, force = false }) {
  const current = listStatus?.num_episodes_watched ?? 0;
  const paused = isPaused(listStatus?.status);
  if (watched < 0) return { skip: "invalid" };
  // Checked before the total, so a paused show never produces a notice.
  if (!force && paused) return { skip: "paused" };
  if (numEpisodes > 0 && watched > numEpisodes) return { skip: "exceeds-total" };
  if (!force && watched <= current) return { skip: "not-ahead" };
  if (force && watched === current) return { skip: "unchanged" };

  const body = { num_watched_episodes: watched };
  // Only the count changes for a paused show, even when it reaches the total.
  if (paused) return { body };
  if (numEpisodes > 0 && watched === numEpisodes) body.status = "completed";
  else if (listStatus?.status !== "watching") body.status = "watching";
  return { body };
}

// The page is on the final episode and the list isn't at the total yet.
export function isLastEpisode({ episode, total, watched }) {
  return (
    Number.isInteger(episode) && total > 0 && episode === total && (watched ?? 0) < total
  );
}
