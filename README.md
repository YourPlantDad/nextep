# NextEp

NextEp is a Firefox extension I made so my MyAnimeList stays up to date while I watch. When you go from one episode to the next on a streaming site you've enabled, it bumps your watched-episode count. It has no dependencies and no build step.

NextEp is my own project. It isn't affiliated with or endorsed by MyAnimeList.

## What it does

NextEp remembers the last episode you opened for each show. When the page goes from episode N to episode N+1 of the same show, it sets your watched episodes to N on MyAnimeList. For example, `https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-4` followed by `.../ep-5` sets "Jujutsu Kaisen 2nd Season" to 4 watched episodes.

- Only an exact step to the next episode counts. Opening the same episode again does nothing.
- Going back or skipping ahead (say ep 4 to ep 6) does nothing, except that the new episode becomes the one it remembers.
- It remembers per show, not per tab. That survives a browser restart, and it works if the next episode opens in a new tab.
- Automatic updates never lower your count. If MyAnimeList already shows N or more, nothing is written.
- The status is set to "watching" if the anime isn't on your list yet or is on plan to watch. It's set to "completed" when the count reaches the total number of episodes.
- If the anime is on hold or dropped, NextEp doesn't overwrite that. Nothing is written. NextEp remembers the highest episode it would have recorded, and the popup offers a button to pick the show back up (see below).
- If the episode number is higher than MyAnimeList's total, nothing is written. The site probably numbers episodes differently.
- In the popup, the `−1` and `+1` buttons are the only things that can lower the count. "Mark episode N watched" never lowers it, and it's disabled ("Episode N already watched") if your list is already at N or beyond. On an anime that's on hold or dropped they change only the count and leave the status alone. Results of popup actions show in the popup.

## The popup

For a matched anime the popup shows, top to bottom, the title (a link to MyAnimeList), "Watched X / Y", a status menu, one main action, the `−1` and `+1` buttons, "Wrong anime?", and a footer with "Settings" and "Report a problem".

- The status menu holds Watching, Completed, On hold, Dropped and Plan to watch. It shows "Not on your list" until the anime is on it. Changing it sends only the status. The one exception is Completed on an anime with a known total, which also sets the count to the total. The last entry, "Remove from your list…", asks first, and then takes the anime off your list, score and progress included. Watching another episode later adds it again like any new anime.
- The main action is the first of these that applies. If the anime is on hold or dropped, it says so and offers "Set to watching and record episode N", where N is the larger of this page's episode and the highest episode NextEp skipped. If neither is known the button is just "Set to watching". The count never goes below what your list already has or above the total, and reaching the total completes the show. If the page is the last episode and your list is below the total, it offers "Mark as completed". Otherwise it's "Mark episode N watched".

The toolbar badge shows `?` when the anime isn't confirmed, `!` when you're not signed in, `II` when the anime is on hold or dropped, `✓` on a green background when this page's episode was just recorded, and `end` when the page is the last episode and your list isn't completed. The `II` and `end` badges go by what NextEp last read from MyAnimeList, so they can be a little out of date.

## Install from source

1. Download or clone this repository.
2. In Firefox open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `manifest.json`.

A temporary add-on is gone after Firefox restarts. To keep it on release Firefox it has to be signed by Mozilla (AMO, unlisted). Firefox Developer Edition and Nightly can run unsigned add-ons if you set `xpinstall.signatures.required=false`.

## Getting started

1. Open NextEp's settings (the "Open settings" button or the "Settings" link in the popup, or its entry in `about:addons`) and click "Sign in to MyAnimeList".
2. Open an episode page on your streaming site.
3. Click the NextEp toolbar button. If the page looks like `.../<slug>/ep-<n>`, click "Enable on <host>". Otherwise [teach NextEp the site](#teach-nextep-a-site).
4. Watch. When you move on to the next episode, the previous one gets recorded.

If this build has no built-in Client ID, do [For developers: your own API client](#for-developers-your-own-api-client) first.

## How matching works

NextEp gets the anime name from the page. If the site's rule has a tab title template and the title matches it, the show name in the tab title goes first. It only trusts that name if it shares a word of three or more letters with the address slug, because a tab title can be a placeholder or still belong to the previous page. After that it uses the address slug. Sites often add an ID to the slug (`jujutsu-kaisen-2nd-season-78067`, `some-show-mx__ok`), but real titles can also end in a number or year (`mob-psycho-100`, `hunter-x-hunter-2011`). So it searches MyAnimeList with the full slug first, then again without the last piece if that piece has a digit or an underscore. It only accepts a result on its own when exactly one entry has a title, English title or synonym that equals the full search text after normalizing (case, punctuation and diacritics ignored). Long titles are cut to 64 characters for the search, but the comparison uses the whole text.

A third guess, the slug without its last two pieces, only fills the suggestion list. It's never accepted by itself, and it's only searched when the other guesses found nothing at all. Otherwise the suggestions come from the last guess that found something.

If there's no clear match, the toolbar badge shows `?`. Open the popup and pick one of the candidates, or search yourself. The episode that was waiting gets applied once you choose. If the page was opened while you were signed out, the match gets worked out the first time you open the popup after signing in. If MyAnimeList answers a search with an error other than a rejected query (network, server, expired session), no match is stored and the next visit or popup open tries again. A stored match is never redone automatically. If it's wrong, use "Wrong anime?" in the popup.

## Site rules

No site is enabled by default. There are two ways to add one in the popup, and you can also write a rule by hand in the settings.

On a page whose URL looks like `.../<slug>/ep-<n>` or `.../<slug>/episode-<n>`, the popup offers "Enable on <host>". That also records the current page as the last episode seen.

### Teach NextEp a site

For any other site, teach it two example pages.

1. Open episode 1 of any show on the site, click the toolbar button, then "This is episode 1".
2. Open episode 2 of the same show, click the toolbar button, then "This is episode 2".

NextEp compares the two pages and writes a rule. It looks for the episode number in the address first. It only counts when the two addresses differ by exactly 1 and 2, so an internal ID that happens to go from 136407 to 136408 isn't mistaken for an episode. It does the same with the tab title. If both have the episode, the address is the source and the title is kept as a cross-check and for the show name. If only the title has it, the title is the source. When a rule is learned, the popup tells you where the episode number comes from and shows the address template. Teaching a site again replaces its rule. "Start over" in the popup throws away the first page.

A rule only keeps the address parts it needs: the show name, the episode number, and the path around them. Query parameters that hold neither (a language, a server) are left out.

### Templates

A rule has a website, an address template and, if it needs one, a tab title template. You can edit them in the settings. A template is plain text with three blocks.

- `{show}` is the name of the show. An address template needs exactly one.
- `{episode}` is the episode number. It can show up once.
- `{anything}` matches any text.

Example: `/watch/{show}/ep-{episode}` matches `/watch/some-show-12/ep-4`.

An address template is a path plus, if you want, a list of query parameters: `/anime/watch?id={show}&ep={episode}`. The path is matched against the decoded address, and a trailing `/` is optional. Every parameter in the template has to be in the page's address. The order doesn't matter and extra parameters are ignored. A parameter value is literal text or has one block in it. The tab title template is matched without caring about case, and any run of spaces, `-`, `:`, `|` and `·` in it matches any run of those. So `{show} Episode {episode}{anything}` matches both "Some Show Episode 2 English SUB at ExampleSite" and "Some Show - Episode 2". A leading "Watch " is dropped from the show name read out of a title. The show can also come after the number: `Episode {episode} {show}`.

A rule also says where the episode number comes from: the address, the tab title, or nowhere. The website matches the page's website exactly, or any subdomain of it (`notexample.tv` doesn't match `example.tv`).

### Tab title as a source and a cross-check

Some sites keep the episode number only in the tab title. For those, NextEp waits until the title has loaded or changed before it counts the visit, because the title is still the previous page's when the address changes.

When a rule has both, the address wins. The one exception is an address number that can't be an episode: it's higher than MyAnimeList's total, or higher than 2000 when the total isn't known, while the title number fits. Then the title number is used, again only once the title has changed. A stale title never overrides an address that makes sense.

### Sites that only work with the buttons

Some sites show the episode number in neither the address nor the title. NextEp can still tell which show you're on, so the popup shows your count with `−1` and `+1`. There's no "Mark episode N watched" button and nothing updates on its own. You update your list with the buttons.

### Old regex rules

Rules from earlier versions are still a website and a JavaScript regular expression, tested against the path plus query string. They need the named groups `(?<slug>...)` and `(?<ep>...)`. Example: `^/watch/(?<slug>[^/]+)/ep-(?<ep>\d+)`. The slug is URI-decoded and lowercased, and episode 0 never matches. The settings show these with a "Regex pattern" field. Each rule is a collapsed entry that shows just the website. Open it to edit the fields or remove it. "Add website" adds a new one, already open.

## For developers: your own API client

This is for people who build NextEp themselves or run their own version of it. A normal install doesn't need it. A build without a built-in Client ID needs it before the first sign-in. It's the collapsed section at the bottom of the settings, "For developers: use your own MyAnimeList API client".

1. Go to <https://myanimelist.net/apiconfig> and create an ID. Set App Type to "other" and "App Redirect URL" to the value shown in the settings (it comes from the add-on ID `nextep@yourplantdad.github.io`).
2. Paste the Client ID into the settings and save. You only need a Client Secret if MyAnimeList gave you one for your app type. It's only ever sent together with your own Client ID.
3. Sign in.

Changing the Client ID signs you out, because a token only works with the client that issued it.

## When an episode is recorded

The toolbar badge shows `✓` on that page. NextEp also opens the popup for a moment with "Recorded episode N." and closes it after four seconds. Move the pointer over it or press a key to keep it open. This needs a recent Firefox (149 or later) and a focused window. Older versions just show the badge. The settings have a checkbox, "Open the popup for a moment when an episode is recorded", to turn it off.

## Permissions

| Permission | Used for |
| --- | --- |
| `tabs` | Reading tab URLs and titles to spot episode changes (including in-page navigation) and to show the popup state. |
| `storage` | Settings, tokens, show-to-anime matches, the last episode seen per show and the first example page while you teach a site. |
| `identity` | The MyAnimeList sign-in flow (`launchWebAuthFlow`) and the redirect URL. |
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
- The last episode of a show has no "next" URL, so record it with the popup button "Mark as completed".
- Sites that number episodes differently from MyAnimeList aren't updated automatically (episodes beyond the total are skipped).
- Sites that show the episode number in neither the address nor the tab title can only be used with the popup buttons.
- If MyAnimeList rejects a search query (a very short title, for example), the show stays unmatched and you pick it by hand in the popup.

## License

Copyright (C) 2026 YourPlantDad

NextEp is free software under the GNU General Public License, version 3, as published by the Free Software Foundation. It comes with no warranty. See [LICENSE](LICENSE).
