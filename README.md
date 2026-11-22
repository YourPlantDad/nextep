# NextEp

NextEp is a Firefox extension I made so my MyAnimeList stays up to date while I watch. When you go from one episode to the next on a streaming site you've enabled, it bumps your watched-episode count. It has no dependencies and no build step.

NextEp is my own project. It isn't affiliated with or endorsed by MyAnimeList.

## What it does

NextEp remembers the last episode you opened for each show. When the URL goes from episode N to episode N+1 of the same show, it sets your watched episodes to N on MyAnimeList. For example, `https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-4` followed by `.../ep-5` sets "Jujutsu Kaisen 2nd Season" to 4 watched episodes.

- Only an exact step to the next episode counts. Opening the same episode again does nothing.
- Going back or skipping ahead (say ep 4 to ep 6) does nothing, except that the new episode becomes the one it remembers.
- It remembers per show, not per tab. That survives a browser restart, and it works if the next episode opens in a new tab.
- Automatic updates never lower your count. If MyAnimeList already shows N or more, nothing is written.
- The status is set to "watching" if the anime isn't being watched yet (not on your list, plan to watch, on hold or dropped). It's set to "completed" when the count reaches the total number of episodes.
- If the episode number is higher than MyAnimeList's total, nothing is written and you get a notification. The site probably numbers episodes differently.
- In the popup, the `−1` and `+1` buttons are the only things that can lower the count. "Mark episode N watched" never lowers it, and it's disabled ("Episode N already watched") if your list is already at N or beyond. Results of popup actions show in the popup, with no desktop notification.

## Install from source

1. Download or clone this repository.
2. In Firefox open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `manifest.json`.

A temporary add-on is gone after Firefox restarts. To keep it on release Firefox it has to be signed by Mozilla (AMO, unlisted). Firefox Developer Edition and Nightly can run unsigned add-ons if you set `xpinstall.signatures.required=false`.

## Getting started

1. Open NextEp's settings (the "Open settings" button in the popup, or its entry in `about:addons`) and click "Sign in to MyAnimeList".
2. Open an episode page on your streaming site.
3. Click the NextEp toolbar button, then "Enable on <host>".
4. Watch. When you move on to the next episode, the previous one gets recorded.

If this build has no built-in Client ID, do [Advanced: own API client](#advanced-own-api-client) first.

## How matching works

NextEp gets the anime from the URL slug. Sites often add a numeric ID to it (`jujutsu-kaisen-2nd-season-78067`), but real titles can also end in a number or year (`mob-psycho-100`, `hunter-x-hunter-2011`). So it searches MyAnimeList with the full slug first, then again with one trailing number removed. It only accepts a result on its own when exactly one entry has a title, English title or synonym that equals the query after normalizing (case, punctuation and diacritics ignored).

If there's no clear match, the toolbar badge shows `?`. Open the popup and pick one of the candidates, or search yourself. The episode that was waiting gets applied once you choose. If the page was opened while you were signed out, the match gets worked out the first time you open the popup after signing in. If MyAnimeList answers a search with an error other than a rejected query (network, server, expired session), no match is stored and the next visit or popup open tries again. A stored match is never redone automatically. If it's wrong, use "Wrong anime?" in the popup.

## Site rules

No site is enabled by default. On a page whose URL looks like `.../<slug>/ep-<n>` or `.../<slug>/episode-<n>`, the popup offers "Enable on <host>". That also records the current page as the last episode seen.

For other URL shapes, add a rule in the settings. A rule has a host and a pattern.

- The host matches the page host exactly, or any subdomain of it (`notexample.tv` doesn't match `example.tv`).
- The pattern is a JavaScript regular expression, tested against the path plus query string. It needs the named groups `(?<slug>...)` and `(?<ep>...)`.

Example: `^/watch/(?<slug>[^/]+)/ep-(?<ep>\d+)`. The slug is URI-decoded and lowercased, and episode 0 never matches.

## Advanced: own API client

A build may come with a built-in MyAnimeList Client ID. If yours doesn't, or you'd rather use your own, open "Advanced" in the settings.

1. Go to <https://myanimelist.net/apiconfig> and create an ID. Set App Type to "other" and "App Redirect URL" to the value shown in the settings (it comes from the add-on ID `nextep@yourplantdad.github.io`).
2. Paste the Client ID into the settings and save. You only need a Client Secret if MyAnimeList gave you one for your app type. It's only ever sent together with your own Client ID.
3. Sign in.

Changing the Client ID signs you out, because a token only works with the client that issued it.

## Permissions

| Permission | Used for |
| --- | --- |
| `tabs` | Reading tab URLs to spot episode changes (including in-page navigation) and to show the popup state. |
| `storage` | Settings, tokens, show-to-anime matches and the last episode seen per show. |
| `identity` | The MyAnimeList sign-in flow (`launchWebAuthFlow`) and the redirect URL. |
| `notifications` | Optional notices ("Tracking ...", "watched 4/23", match needs confirming). You can turn them off in settings. |
| `https://api.myanimelist.net/*` | MyAnimeList API calls (search, read and update your list). |
| `https://myanimelist.net/*` | Sign-in and token endpoints. |

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Reporting bugs or abuse

Bug reports and feature requests go in the [issue tracker](https://github.com/YourPlantDad/nextep/issues/new/choose). "Report a problem" in the popup and settings opens the same page. I'm not taking pull requests at the moment, so if you want something changed, open an issue. For security problems, use the private reporting described in [SECURITY.md](SECURITY.md) instead of a public issue.

## Development

```
npm test
npx --yes web-ext lint --source-dir .
```

`npm test` runs `node --test "tests/*.test.js"`, so there's nothing to install. I run `web-ext lint` ad hoc and don't keep it as a dependency. CI (`.github/workflows/ci.yml`) runs both on every push to `main` and on pull requests, and lint errors fail the job. Logic that can be pure lives in `src/lib/` and is unit-tested in Node. `src/background/main.js`, the popup and the options page are wiring and DOM code, and the tests don't cover them.

## Limitations

- Temporary add-ons are removed when Firefox restarts (see [Install from source](#install-from-source)).
- The last episode of a show has no "next" URL, so record it with the popup button "Mark episode N watched".
- Sites that number episodes differently from MyAnimeList aren't updated automatically (episodes beyond the total are skipped).
- If MyAnimeList rejects a search query (a very short title, for example), the show stays unmatched and you pick it by hand in the popup.

## License

Copyright (C) 2026 YourPlantDad

NextEp is free software under the GNU General Public License, version 3, as published by the Free Software Foundation. It comes with no warranty. See [LICENSE](LICENSE).
