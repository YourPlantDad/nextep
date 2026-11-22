import { candidateQueries, exactMatches, truncateQuery, usableTitleName } from "./title-match.js";
import { computeUpdate, isPaused, LIST_STATUSES } from "./progress.js";
import { pickEpisode } from "./url-parser.js";

const SEARCH_FIELDS = "alternative_titles,num_episodes,media_type,start_season";
const DETAIL_FIELDS = "num_episodes,my_list_status,alternative_titles,media_type";

const toCandidate = (n) => ({
  id: n.id,
  title: n.title,
  mediaType: n.media_type,
  numEpisodes: n.num_episodes ?? 0,
});

export function createTracker({ store, api, notify, now = Date.now }) {
  const confirmNotified = new Set();
  let queue = Promise.resolve();

  async function searchFor(candidate) {
    try {
      return await api.search(truncateQuery(candidate.text), { limit: 10, fields: SEARCH_FIELDS });
    } catch (e) {
      // MyAnimeList rejected this query, so leave the show unmatched and let the user pick.
      // Any other error is thrown before a mapping is stored, so the next visit tries again.
      if (e.status !== 400) throw e;
      return [];
    }
  }

  async function resolveMapping(key, slug, rawTitleName) {
    const candidates = candidateQueries(slug, usableTitleName(slug, rawTitleName));
    let lastResults = [];
    let multiple = [];
    for (const candidate of candidates.filter((c) => c.auto)) {
      const nodes = await searchFor(candidate);
      // Compare against the full text, not the cut one, so long titles can match.
      const exact = exactMatches(candidate.text, nodes);
      if (exact.length === 1) {
        const [node] = exact;
        await store.setMapping(key, {
          malId: node.id,
          title: node.title,
          numEpisodes: node.num_episodes ?? 0,
          confirmed: true,
          candidates: [],
        });
        await notify(`Tracking "${node.title}"`);
        return;
      }
      if (exact.length > 1) multiple = exact;
      if (nodes.length > 0) lastResults = nodes;
    }
    // The shorter guesses only help fill the list, and only if nothing else found anything.
    if (multiple.length === 0 && lastResults.length === 0) {
      for (const candidate of candidates.filter((c) => !c.auto)) {
        const nodes = await searchFor(candidate);
        if (nodes.length > 0) lastResults = nodes;
      }
    }

    const pool = multiple.length > 0 ? multiple : lastResults;
    const [best] = pool;
    await store.setMapping(key, {
      malId: best?.id ?? null,
      title: best?.title,
      numEpisodes: best?.num_episodes ?? 0,
      confirmed: false,
      candidates: pool.slice(0, 5).map(toCandidate),
    });
    await notify("Not sure which anime this is. Open the popup to confirm.");
  }

  // Keeps the last list status read from MAL on the mapping, for the badge, and keeps
  // `paused` in step with it. pausedAtLeast raises the episode waiting to be recorded.
  async function recordList(key, status, watched, { pausedAtLeast = 0 } = {}) {
    if (!key) return;
    const mapping = await store.getMapping(key);
    if (!mapping) return;
    const next = { ...mapping, listStatus: status ? { status, watched } : null };
    if (isPaused(status)) {
      next.paused = status;
      const episode = Math.max(mapping.pausedEpisode ?? 0, pausedAtLeast);
      if (episode > 0) next.pausedEpisode = episode;
    } else {
      delete next.paused;
      delete next.pausedEpisode;
    }
    await store.setMapping(key, next);
  }

  async function applyProgressNow(malId, n, { force = false, silent = false, key } = {}) {
    const node = await api.details(malId, "num_episodes,my_list_status");
    const numEpisodes = node.num_episodes ?? 0;
    const title = node.title ?? `Anime ${malId}`;
    const current = node.my_list_status;
    const plan = computeUpdate({
      listStatus: current,
      numEpisodes,
      watched: n,
      force,
    });
    if (plan.skip) {
      // An episode above the total can't be recorded later, so a paused show doesn't keep it.
      const fits = !(numEpisodes > 0 && n > numEpisodes);
      await recordList(key, current?.status, current?.num_episodes_watched ?? 0, {
        pausedAtLeast: plan.skip === "paused" && fits ? n : 0,
      });
      if (plan.skip === "exceeds-total" && !silent) {
        await notify(
          `${title}: episode ${n} is higher than MyAnimeList's ${numEpisodes} episodes, so it wasn't updated (the site may number episodes differently)`,
        );
      }
      return { updated: false, skip: plan.skip, numEpisodes };
    }
    const listStatus = await api.updateStatus(malId, plan.body);
    await recordList(key, plan.body.status ?? current?.status, plan.body.num_watched_episodes);
    const completed = plan.body.status === "completed" ? ", completed" : "";
    if (!silent) await notify(`${title}: watched ${n}/${numEpisodes || "?"}${completed}`);
    return { updated: true, numEpisodes, listStatus };
  }

  async function resumeNow(key, episode) {
    const mapping = await store.getMapping(key);
    if (!mapping?.malId) throw new Error("No anime selected for this show.");
    const node = await api.details(mapping.malId, "num_episodes,my_list_status");
    const total = node.num_episodes ?? 0;
    const current = node.my_list_status?.num_episodes_watched ?? 0;
    let count = Math.max(current, mapping.pausedEpisode ?? 0, episode ?? 0);
    if (total > 0) count = Math.min(count, total);
    // Reaching the total completes the show, same as everywhere else.
    const status = total > 0 && count === total ? "completed" : "watching";
    const listStatus = await api.updateStatus(mapping.malId, {
      status,
      num_watched_episodes: count,
    });
    await recordList(key, status, count);
    return { updated: true, numEpisodes: total, listStatus };
  }

  async function setStatusNow(key, status) {
    if (!LIST_STATUSES.includes(status)) throw new Error("That isn't a list status.");
    const mapping = await store.getMapping(key);
    if (!mapping?.malId) throw new Error("No anime selected for this show.");
    const node = await api.details(mapping.malId, "num_episodes,my_list_status");
    const total = node.num_episodes ?? 0;
    const body = { status };
    if (status === "completed" && total > 0) body.num_watched_episodes = total;
    const listStatus = await api.updateStatus(mapping.malId, body);
    const watched = body.num_watched_episodes ?? node.my_list_status?.num_episodes_watched ?? 0;
    await recordList(key, status, watched);
    return { updated: true, numEpisodes: total, listStatus };
  }

  async function noteListStatusNow(key, listStatus) {
    await recordList(key, listStatus?.status, listStatus?.num_episodes_watched ?? 0);
  }

  async function markWatched(key, n) {
    const mapping = await store.getMapping(key);
    if (mapping.malId === null || !mapping.confirmed) {
      await store.setMapping(key, {
        ...mapping,
        pendingEpisode: Math.max(mapping.pendingEpisode ?? 0, n),
      });
      if (!confirmNotified.has(key)) {
        confirmNotified.add(key);
        await notify("Pick the right anime in the popup to record your progress");
      }
      return { pending: true };
    }
    return applyProgressNow(mapping.malId, n, { key });
  }

  // trigger says what changed: "url" is a bare address change, "title" is a loaded or
  // changed title. The tab title is still the old page's right after an address change.
  async function visit(parsed, trigger = "title") {
    const { slug, key, titleName, source } = parsed;
    if (source === "none") {
      // Nothing to count. Just make sure the show has a mapping.
      if (await store.isSignedIn()) {
        await ensureMappingNow(key, slug, trigger === "title" ? titleName : null);
      }
      return;
    }
    if (source === "title" && trigger === "url") return;

    const known = await store.getMapping(key);
    const total = known?.malId ? (known.numEpisodes ?? 0) : 0;
    const { episode, fromTitle } = pickEpisode(parsed, total);
    if (episode === null || episode === undefined) {
      // Unknown episode: record nothing, but the title can still name the show.
      if (source === "url" && trigger === "title" && !known && (await store.isSignedIn())) {
        await ensureMappingNow(key, slug, titleName);
      }
      return;
    }
    if (fromTitle && trigger === "url") return;

    const prev = await store.getLastSeen(key);
    await store.setLastSeen(key, { episode, at: now() });
    if (!(await store.isSignedIn())) return;
    const step = Boolean(prev) && episode === prev.episode + 1;
    if (!known) {
      // With a title template, the title that follows the page load names the show better.
      // A step still needs the mapping now, so that one goes by the slug alone.
      const waitForTitle = parsed.hasTitleTemplate && trigger === "url" && !step;
      if (!waitForTitle) {
        await ensureMappingNow(key, slug, trigger === "title" ? titleName : null);
      }
    }
    if (step) await markWatched(key, prev.episode);
  }

  async function ensureMappingNow(key, slug, titleName) {
    if (!(await store.getMapping(key))) await resolveMapping(key, slug, titleName);
  }

  async function selectMappingNow(key, malId) {
    const node = await api.details(malId, DETAIL_FIELDS);
    const existing = await store.getMapping(key);
    await store.setMapping(key, {
      malId: node.id,
      title: node.title,
      numEpisodes: node.num_episodes ?? 0,
      confirmed: true,
      candidates: [],
    });
    if (existing?.pendingEpisode) return applyProgressNow(node.id, existing.pendingEpisode, { key });
    return null;
  }

  // Everything public goes through one queue so read-modify-write steps on storage
  // can't interleave. The *Now functions call each other directly and never go back
  // through the queue, which would deadlock.
  function enqueue(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  return {
    handleVisit: (parsed, trigger) => enqueue(() => visit(parsed, trigger)),
    ensureMapping: (key, slug, titleName) =>
      enqueue(() => ensureMappingNow(key, slug, titleName)),
    applyProgress: (malId, n, options) => enqueue(() => applyProgressNow(malId, n, options)),
    selectMapping: (key, malId) => enqueue(() => selectMappingNow(key, malId)),
    resume: (key, episode) => enqueue(() => resumeNow(key, episode)),
    setStatus: (key, status) => enqueue(() => setStatusNow(key, status)),
    noteListStatus: (key, listStatus) => enqueue(() => noteListStatusNow(key, listStatus)),
  };
}
