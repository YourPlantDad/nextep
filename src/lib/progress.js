// MAL names this field differently per direction: responses use num_episodes_watched,
// the PATCH body uses num_watched_episodes.
export function computeUpdate({ listStatus, numEpisodes, watched, force = false }) {
  const current = listStatus?.num_episodes_watched ?? 0;
  if (watched < 0) return { skip: "invalid" };
  if (numEpisodes > 0 && watched > numEpisodes) return { skip: "exceeds-total" };
  if (!force && watched <= current) return { skip: "not-ahead" };
  if (force && watched === current) return { skip: "unchanged" };

  const body = { num_watched_episodes: watched };
  if (numEpisodes > 0 && watched === numEpisodes) body.status = "completed";
  else if (listStatus?.status !== "watching") body.status = "watching";
  return { body };
}
