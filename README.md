# NextEp

NextEp is a Firefox extension I made so my MyAnimeList stays up to date while I watch. When you go from one episode to the next on a streaming site you've enabled, it raises your watched-episode count.

NextEp isn't affiliated with or endorsed by MyAnimeList.

## What it does

NextEp remembers the last episode you opened for each show. When a page goes from episode N to episode N+1 of the same show, it sets your watched episodes to N on MyAnimeList. For example, `https://example.tv/watch/jujutsu-kaisen-2nd-season-78067/ep-4` followed by `.../ep-5` sets "Jujutsu Kaisen 2nd Season" to 4 watched episodes.

- Only a step to the next episode counts. Opening the same episode again does nothing.
- Going back or skipping ahead (say episode 4 to 6) does nothing, except that the new episode becomes the one NextEp remembers.
- NextEp remembers per show, not per tab. That survives a browser restart, and it works if the next episode opens in a new tab.
- Automatic updates never lower your count. If MyAnimeList already shows N or more, nothing is written.
- The status is set to "watching" if the anime isn't on your list yet or is on plan to watch. It's set to "completed" when the count reaches the total number of episodes.
- If the anime is on hold or dropped, NextEp doesn't change that. It remembers the highest episode it would have recorded, and the popup offers a button to pick the show back up.
- If the episode number is higher than MyAnimeList's total, nothing is written. The site probably numbers episodes differently.
- NextEp doesn't run in private windows.
- If MyAnimeList refuses requests or has trouble, NextEp waits before it tries again by itself, a minute at first and up to half an hour. The popup buttons keep working.

## Installing

NextEp needs Firefox 140 or later.

It isn't on addons.mozilla.org yet. Until it is, you install the file that Mozilla signed from the [latest release](https://github.com/YourPlantDad/nextep/releases/latest).

1. Open the release page in Firefox and click the `.xpi` file under "Assets".
2. Firefox asks if you want to add NextEp. Click "Add". If Firefox saves the file instead, drag it into a Firefox window.

Installed this way, NextEp doesn't update by itself. For a newer version you install the file from the newest release the same way. Your sign-in and settings stay.

To run it from the source files instead, see [DEVELOPING.md](DEVELOPING.md).

## Getting started

1. Open NextEp's settings (the "Open settings" button or the "Settings" link in the popup, or its entry in `about:addons`) and click "Sign in".
2. Open an episode page on your streaming site.
3. Click the NextEp toolbar button. If the page's address looks like `.../<slug>/ep-<n>` or `.../<slug>/episode-<n>`, click "Enable on <host>". Otherwise teach NextEp the site (see below).
4. Watch. When you move on to the next episode, the previous one gets recorded.

No site is enabled by default.

If you want to try NextEp first, there's a demo site at <https://yourplantdad.github.io/nextep/>. It has episode pages and no video.

## Teaching a website

If "Enable on <host>" isn't offered, teach NextEp the site with two example pages.

1. Open episode 1 of any show on the site, click the toolbar button, then "This is episode 1".
2. Open episode 2 of the same show, click the toolbar button, then "This is episode 2".

NextEp compares the two pages and writes a rule. The popup then tells you where the episode number comes from (the address or the tab title) and shows the address it will look for. Teaching a site again replaces its rule. "Start over" in the popup throws away the first page.

Some sites show the episode number in neither the address nor the tab title. NextEp can still tell which show you're on, so the popup shows your count with `−1` and `+1`. Nothing updates on its own on those sites. You update your list with the buttons.

## The popup

For a matched anime the popup shows, top to bottom, the title (a link to MyAnimeList), "Watched X / Y", a status menu, one main button, the `−1` and `+1` buttons, "Wrong anime?", and a footer with "Settings" and "Report a problem".

### Status

The status menu holds Watching, Completed, On hold, Dropped and Plan to watch. It shows "Not on your list" until the anime is on it. Changing it sends only the status. The one exception is Completed on an anime with a known total, which also sets the count to the total.

### Picking a show back up

If the anime is on hold or dropped, the main button says so and offers "Set to watching and record episode N". N is the larger of this page's episode and the highest episode NextEp skipped. If neither is known, the button is just "Set to watching". The count never goes below what your list already has or above the total, and reaching the total completes the show.

### The last episode

If the page is the last episode and your list is below the total, the main button is "Mark as completed". The last episode has no next page, so this is how you record it.

### Other buttons

- Otherwise the main button is "Mark episode N watched". It never lowers your count, and it's disabled ("Episode N already watched") if your list is already at N or beyond.
- `−1` and `+1` are the only things that can lower the count. On an anime that's on hold or dropped they change only the count and leave the status alone.
- "Wrong anime?" lets you pick another match or search for one.
- The last entry in the status menu, "Remove from your list…", asks first and then takes the anime off your list, score and progress included. Watching another episode later adds it again like any new anime.

The results of popup actions show in the popup.

### Finding the anime

NextEp reads the show name from the page address, and from the tab title if the site's rule has one. It searches MyAnimeList and only accepts a result on its own when exactly one entry matches the name. If there's no clear match, the toolbar badge shows `?`. Open the popup and pick one of the candidates, or search yourself. The episode that was waiting gets applied once you choose. If MyAnimeList rejects a search (a very short title, for example), the show stays unmatched until you pick it by hand.

### The check mark and the popup opening

When an episode is recorded, the toolbar badge shows `✓` on that page. NextEp also opens the popup for a moment with "Recorded episode N." and closes it after four seconds. Move the pointer over it or press a key to keep it open. This needs Firefox 149 or later and a focused window. Older versions just show the badge.

The other badge texts are `?` when the anime isn't confirmed, `!` when you're not signed in, `II` when the anime is on hold or dropped, and `end` when the page is the last episode and your list isn't completed. The `II` and `end` badges go by what NextEp last read from MyAnimeList, so they can be a little out of date.

## Settings

- The sign-in button signs you in to MyAnimeList or out again.
- A checkbox turns off the popup that opens for a moment when an episode is recorded.
- "Site rules" lists the websites NextEp tracks. Each one is a collapsed entry that shows just the website. Open it to edit its fields or remove it. "Add website" adds a new entry, already open. Save applies your changes.

A rule has a website, an address template, an optional tab title template, and a place the episode number comes from (the address, the tab title, or nowhere). The website matches the page's website exactly, or any subdomain of it (`notexample.tv` doesn't match `example.tv`).

A template is plain text with three blocks.

- `{show}` is the name of the show. An address template needs exactly one.
- `{episode}` is the episode number. It can appear once.
- `{anything}` matches any text.

For example, `/watch/{show}/ep-{episode}` matches `/watch/some-show-12/ep-4`. A trailing `/` in the address is optional.

An address template can end in query parameters, like `/anime/watch?id={show}&ep={episode}`. They can come in any order, and extra parameters in the page's address are ignored.

The tab title template is optional. It's matched without caring about case, and any run of spaces, `-`, `:`, `|` and `·` in it matches any run of those. For example, `{show} Episode {episode}{anything}` matches both "Some Show Episode 2 English SUB at ExampleSite" and "Some Show - Episode 2". The show can also come after the number: `Episode {episode} {show}`.

## Permissions

| Permission | Used for |
| --- | --- |
| `tabs` | Reading tab addresses and titles to spot episode changes and to show the popup. |
| `storage` | Settings, sign-in tokens, show matches, the last episode seen per show, and the first example page while you teach a site. |
| `identity` | The MyAnimeList sign-in window. |
| `https://api.myanimelist.net/*` | MyAnimeList calls to search, read and update your list. |
| `https://myanimelist.net/*` | Sign-in and token requests. |

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Reporting bugs

Bug reports and feature requests go in the [issue tracker](https://github.com/YourPlantDad/nextep/issues/new/choose). "Report a problem" in the popup and settings opens the same page. I'm not taking pull requests at the moment, so if you want something changed, open an issue. For security problems, use the private reporting described in [SECURITY.md](SECURITY.md) instead of a public issue.

To build, run from source or change NextEp, see [DEVELOPING.md](DEVELOPING.md).

## License

Copyright (C) 2026 YourPlantDad

NextEp is free software under the GNU General Public License, version 3, as published by the Free Software Foundation. It comes with no warranty. See [LICENSE](LICENSE).
