import { test } from "node:test";
import assert from "node:assert/strict";
import { learnRule } from "../src/lib/learn.js";
import { compileTemplate, matchTemplate, addressText } from "../src/lib/template.js";
import { parseTab } from "../src/lib/url-parser.js";

const page = (url, title = "ExampleSite") => ({ url, title });

function matchesAddress(rule, url) {
  return matchTemplate(compileTemplate(rule.url, "url"), addressText(new URL(url)));
}

test("a: episode in the address", () => {
  const r = learnRule(
    page("https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-1"),
    page("https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-2"),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "url",
    rule: { host: "example.tv", url: "/watch/{show}/ep-{episode}", episodeFrom: "url" },
  });
});

const B_RULE = {
  host: "example.tv",
  url: "/watch/{show}",
  title: "{show} Episode {episode}{anything}",
  episodeFrom: "title",
};

test("b: IDs in the address, episode in the tab title", () => {
  const r = learnRule(
    page(
      "https://example.tv/watch/battle-spirits-re-zekkai-no-ku-1-9106?ep=136407",
      "Battle Spirits [Re] Zekkai no Ku Episode 1 English SUB at ExampleSite",
    ),
    page(
      "https://example.tv/watch/battle-spirits-re-zekkai-no-ku-1-9106?ep=136408",
      "Battle Spirits [Re] Zekkai no Ku Episode 2 English SUB at ExampleSite",
    ),
  );
  assert.deepEqual(r, { ok: true, episodeFrom: "title", rule: B_RULE });
});

test("b2: IDs that jump by more than one give the same rule", () => {
  const r = learnRule(
    page(
      "https://example.tv/watch/fortune-quest-9285?ep=137754",
      "Fortune Quest Episode 1 English SUB at ExampleSite",
    ),
    page(
      "https://example.tv/watch/fortune-quest-9285?ep=137760",
      "Fortune Quest Episode 2 English SUB at ExampleSite",
    ),
  );
  assert.deepEqual(r, { ok: true, episodeFrom: "title", rule: B_RULE });
});

test("c: bare number as the last piece", () => {
  const r = learnRule(
    page("https://example.tv/watch/jojo-no-kimyou-na-bouken-tv-mx__ok/1", "Now playing · ExampleSite"),
    page("https://example.tv/watch/jojo-no-kimyou-na-bouken-tv-mx__ok/2", "Now playing · ExampleSite"),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "url",
    rule: { host: "example.tv", url: "/watch/{show}/{episode}", episodeFrom: "url" },
  });
});

const D_RULE = {
  host: "example.tv",
  url: "/watch/{anything}/{show}",
  episodeFrom: "none",
};
const DASH_TITLE = "ExampleSite \u2014 Watch Online";

test("d: no episode anywhere, rule still finds the show", () => {
  const r = learnRule(
    page("https://www.example.tv/watch/195604/black-clover-season-2-8839%3Fep%3D181751", DASH_TITLE),
    page("https://www.example.tv/watch/195604/black-clover-season-2-8839%3Fep%3D185497", DASH_TITLE),
  );
  assert.deepEqual(r, { ok: true, episodeFrom: "none", rule: D_RULE });
  const m = matchesAddress(r.rule, "https://example.tv/watch/21/one-piece-odmau-1642%3Fep%3D2142");
  assert.equal(m.show, "one-piece-odmau-1642");
});

test("d2: consecutive IDs are not read as episodes", () => {
  const r = learnRule(
    page("https://www.example.tv/watch/21/one-piece-odmau-1642%3Fep%3D2142", DASH_TITLE),
    page("https://www.example.tv/watch/21/one-piece-odmau-1642%3Fep%3D2143", DASH_TITLE),
  );
  assert.deepEqual(r, { ok: true, episodeFrom: "none", rule: D_RULE });
});

test("e: episode inside the slug", () => {
  const r = learnRule(
    page(
      "https://example.tv/somali-and-the-forest-spirit-episode-1/",
      "Somali and the Forest Spirit Episode 1 - ExampleSite",
    ),
    page(
      "https://example.tv/somali-and-the-forest-spirit-episode-2/",
      "Somali and the Forest Spirit Episode 2 - ExampleSite",
    ),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "url",
    rule: {
      host: "example.tv",
      url: "/{show}-episode-{episode}/",
      title: "{show} Episode {episode}{anything}",
      episodeFrom: "url",
    },
  });
  const long = "romeria-senki-maou-wo-taoshita-nochi-mo-jinrui-yabasou-dakara-guntai-soshiki-shita";
  const m = matchesAddress(r.rule, `https://example.tv/${long}-episode-2/`);
  assert.equal(m.episode, 2);
  assert.equal(m.show, long);
});

test("identical addresses, titles 1 then 2 -> episode from the title", () => {
  const r = learnRule(
    page("https://example.tv/watch/some-show-12", "Some Show Episode 1 - ExampleSite"),
    page("https://example.tv/watch/some-show-12", "Some Show Episode 2 - ExampleSite"),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "title",
    rule: {
      host: "example.tv",
      url: "/watch/{show}",
      title: "{show} Episode {episode}{anything}",
      episodeFrom: "title",
    },
  });
});

test("title without a lead drops {show}", () => {
  const r = learnRule(
    page("https://example.tv/watch/x-1", "Episode 1 | ExampleSite"),
    page("https://example.tv/watch/x-1", "Episode 2 | ExampleSite"),
  );
  assert.equal(r.rule.title, "Episode {episode} {show}");
  const bare = learnRule(
    page("https://example.tv/watch/x-1", "Episode 1"),
    page("https://example.tv/watch/x-1", "Episode 2"),
  );
  assert.equal(bare.rule.title, "Episode {episode}{anything}");
  assert.equal(r.rule.title, "Episode {episode} {show}");
});

test("a title number with no word before it can't be used", () => {
  const r = learnRule(
    page("https://example.tv/watch/x-1", "1 | ExampleSite"),
    page("https://example.tv/watch/x-1", "2 | ExampleSite"),
  );
  assert.equal(r.episodeFrom, "none");
  assert.equal(r.rule.title, undefined);
});

test("leading zeros count as episode 1 and 2", () => {
  const r = learnRule(
    page("https://example.tv/watch/some-show/ep-01"),
    page("https://example.tv/watch/some-show/ep-02"),
  );
  assert.equal(r.rule.url, "/watch/{show}/ep-{episode}");
  assert.equal(r.episodeFrom, "url");
});

test("episodes 2 and 3 are not episodes 1 and 2", () => {
  const r = learnRule(
    page("https://example.tv/watch/some-show/ep-2"),
    page("https://example.tv/watch/some-show/ep-3"),
  );
  assert.equal(r.episodeFrom, "none");
});

test("different hosts and non-http addresses fail", () => {
  const a = learnRule(page("https://example.tv/a/ep-1"), page("https://example.org/a/ep-2"));
  assert.equal(a.ok, false);
  assert.match(a.error, /different sites/);
  const b = learnRule(page("ftp://example.tv/a/ep-1"), page("https://example.tv/a/ep-2"));
  assert.equal(b.ok, false);
  const c = learnRule(page("nope"), page("https://example.tv/a/ep-2"));
  assert.equal(c.ok, false);
});

test("www and bare host count as the same site", () => {
  const r = learnRule(
    page("https://www.example.tv/w/s-1/ep-1"),
    page("https://example.tv/w/s-1/ep-2"),
  );
  assert.equal(r.ok, true);
  assert.equal(r.rule.host, "example.tv");
});

test("learned rules work with parseTab", () => {
  const learned = learnRule(
    page(
      "https://example.tv/watch/fortune-quest-9285?ep=137754",
      "Fortune Quest Episode 1 English SUB at ExampleSite",
    ),
    page(
      "https://example.tv/watch/fortune-quest-9285?ep=137760",
      "Fortune Quest Episode 2 English SUB at ExampleSite",
    ),
  );
  const parsed = parseTab(
    {
      url: "https://example.tv/watch/fortune-quest-9285?ep=137770",
      title: "Fortune Quest Episode 3 English SUB at ExampleSite",
    },
    [learned.rule],
  );
  assert.deepEqual(parsed, {
    host: "example.tv",
    slug: "fortune-quest-9285",
    episode: 3,
    key: "example.tv|fortune-quest-9285",
    urlEpisode: null,
    titleEpisode: 3,
    titleName: "Fortune Quest",
    hasTitleTemplate: true,
    source: "title",
  });
});

const SHOW_EPISODE_TITLE = "{show} Episode {episode}{anything}";

test("f: first page has no episode parameter, title has it", () => {
  const r = learnRule(
    page(
      "https://f.example/watch/attack-on-titan-dual-audio-25",
      "Ep 1 - Watch Attack on Titan English Sub/Dub online Free on SiteF",
    ),
    page(
      "https://f.example/watch/attack-on-titan-dual-audio-25?episode=2",
      "Ep 2 - Watch Attack on Titan English Sub/Dub online Free on SiteF",
    ),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "title",
    rule: { host: "f.example", url: "/watch/{show}", title: "Ep {episode} {show}", episodeFrom: "title" },
  });
});

test("g: episode in a query parameter, title kept as a cross-check", () => {
  const r = learnRule(
    page(
      "https://www.g.example/watch/one-piece-21?ep=1",
      "Watch ONE PIECE Episode 1 English Sub Online Free | SiteG",
    ),
    page(
      "https://www.g.example/watch/one-piece-21?ep=2",
      "Watch ONE PIECE Episode 2 English Sub Online Free | SiteG",
    ),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "url",
    rule: {
      host: "g.example",
      url: "/watch/{show}?ep={episode}",
      title: SHOW_EPISODE_TITLE,
      episodeFrom: "url",
    },
  });
  const parsed = parseTab(
    {
      url: "https://g.example/watch/one-piece-21?ep=3",
      title: "Watch ONE PIECE Episode 3 English Sub Online Free | SiteG",
    },
    [r.rule],
  );
  assert.equal(parsed.titleName, "ONE PIECE");
  assert.equal(parsed.urlEpisode, 3);
  assert.equal(parsed.titleEpisode, 3);
});

test("h1: ep is 1 and 2 for the first show, so the address wins", () => {
  const r = learnRule(
    page("https://h.example/watch/one-piece-1?ep=1", "One Piece Episode 1 | SiteH"),
    page("https://h.example/watch/one-piece-1?ep=2", "One Piece Episode 2 | SiteH"),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "url",
    rule: {
      host: "h.example",
      url: "/watch/{show}?ep={episode}",
      title: SHOW_EPISODE_TITLE,
      episodeFrom: "url",
    },
  });
});

test("h2: ep is an internal ID, so the title wins", () => {
  const r = learnRule(
    page(
      "https://h.example/watch/tokyo-revengers-war-of-the-three-titan-arc-10486?ep=149945",
      "Tokyo Revengers: War of the Three Titan Arc Episode 1 | SiteH",
    ),
    page(
      "https://h.example/watch/tokyo-revengers-war-of-the-three-titan-arc-10486?ep=150093",
      "Tokyo Revengers: War of the Three Titan Arc Episode 2 | SiteH",
    ),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "title",
    rule: {
      host: "h.example",
      url: "/watch/{show}",
      title: SHOW_EPISODE_TITLE,
      episodeFrom: "title",
    },
  });
});

test("i: show is an id parameter, other parameters in any order", () => {
  const r = learnRule(
    page("https://i.example/anime/watch?id=21&ep=1&lang=hindi&svr=igris", "Episode 1 - ONE PIECE"),
    page("https://i.example/anime/watch?id=21&ep=2&lang=hindi&svr=igris", "Episode 2 - ONE PIECE"),
  );
  assert.deepEqual(r, {
    ok: true,
    episodeFrom: "url",
    rule: {
      host: "i.example",
      url: "/anime/watch?id={show}&ep={episode}",
      title: "Episode {episode} {show}",
      episodeFrom: "url",
    },
  });
  const m = matchesAddress(
    r.rule,
    "https://i.example/anime/watch?id=14&src=a&ep=2&lang=hindi&svr=igris",
  );
  assert.deepEqual(m, { show: "14", episode: 2 });
  const placeholder = parseTab(
    {
      url: "https://i.example/anime/watch?id=14&src=a&ep=1&lang=hindi&svr=igris",
      title: "Watch Episode 1 of Anime - SiteI",
    },
    [r.rule],
  );
  assert.equal(placeholder.titleEpisode, null);
  assert.equal(placeholder.titleName, null);
  assert.equal(placeholder.urlEpisode, 1);
});
