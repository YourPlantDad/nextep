# NextEp privacy policy

Date: 2026-11-24

NextEp is my own Firefox extension for updating your MyAnimeList episode count. I don't get any of your data. There's no server.

## What is sent to MyAnimeList

- The show name. On sites you've enabled, NextEp takes the show name from the episode page URL, and from the tab title if the site's rule uses it, and searches MyAnimeList for it, to find the right anime. Searches you type in the popup are sent the same way.
- Your list. Using your own MyAnimeList sign-in, NextEp reads your list entry for the matched anime and updates the number of watched episodes (and the list status, like "watching" or "completed").
- Sign-in. You sign in on MyAnimeList's own page, so NextEp never sees your password. It gets an access token and a refresh token, and exchanges and refreshes them with MyAnimeList. Right after that it asks MyAnimeList for your username.

MyAnimeList's own terms and privacy policy apply to whatever it receives.

Nothing goes to me or to anyone else. NextEp has no analytics or tracking and loads no remote code.

## What is stored on your device

This is in Firefox's extension storage:

- your access and refresh tokens, and when they were issued and when they expire, plus your MyAnimeList username, which is only used to show who's signed in
- your settings: whether the popup opens when an episode is recorded, and your site rules
- show matches: for each show, the site host and the name from the URL, the matched anime and the candidate matches, and any episode waiting for confirmation
- the last episode seen for each show, with a timestamp, and the last episode recorded to your list, with a timestamp
- while you teach a site, the address and tab title of the first example page, until you finish or start over

## Which pages are read

NextEp needs the `tabs` permission to see page URLs and titles, so it can read the URL and title of any tab. It only acts on pages of sites you've enabled. On those pages it reads the tab title too, and the show name from it can be sent to MyAnimeList as a search. URLs and titles of other pages aren't stored and aren't sent anywhere. The popup also checks the current tab's URL and title locally, to offer "Enable on this site" and teaching. NextEp doesn't run in private windows, so nothing from them is read or stored.

## Removing your data

- Signing out in the NextEp settings deletes the stored tokens.
- Removing the add-on deletes everything NextEp stored on your device.
- Changes already made to your MyAnimeList list stay there. Edit them on MyAnimeList.

## Contact

Open an issue at <https://github.com/YourPlantDad/nextep/issues/new/choose>. For security problems, use the private reporting described in [SECURITY.md](SECURITY.md).
