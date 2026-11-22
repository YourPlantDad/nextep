import { isPaused } from "./progress.js";

// Uses only what's stored, so it never needs a MyAnimeList call. "!" beats "?" beats "II"
// beats the check mark beats "end". The check mark means this page's episode was just recorded.
export function badgeText({ signedIn, parsed, mapping, episode }) {
  if (!parsed) return "";
  if (!signedIn) return "!";
  if (!mapping || !mapping.confirmed || mapping.malId === null) return "?";
  if (isPaused(mapping.paused)) return "II";
  if (episode != null && mapping.lastRecorded?.pageEpisode === episode) return "✓";
  const total = mapping.numEpisodes ?? 0;
  if (total > 0 && episode === total && mapping.listStatus?.status !== "completed") return "end";
  return "";
}
