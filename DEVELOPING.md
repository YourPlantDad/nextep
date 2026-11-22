# Developing NextEp

This is for people who build or change NextEp. How to use it is in [README.md](README.md). NextEp has no dependencies and no build step. It is plain ES modules.

## Running from source

1. Clone or download this repository.
2. In Firefox open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `manifest.json`.

A temporary add-on is gone after Firefox restarts. To keep it on release Firefox it has to be signed by Mozilla (AMO, unlisted). Firefox Developer Edition and Nightly can run unsigned add-ons if you set `xpinstall.signatures.required=false`.

A build without a Client ID in `src/lib/config.js` can't sign in. See [Using your own MyAnimeList API client](#using-your-own-myanimelist-api-client).

## Project layout

- `manifest.json` is the add-on manifest (Manifest V2, with the add-on ID).
- `icons/` holds the toolbar icon.
- `src/background/` is the background page. `main.js` handles tab events and the messages from the popup and settings page.
- `src/popup/` is the toolbar popup.
- `src/options/` is the settings page.
- `src/lib/` holds the logic that can be pure, so it runs in Node. Rules and templates are in `template.js`, `url-parser.js`, `learn.js` and `one-click.js`. MyAnimeList access is in `oauth.js` and `mal-api.js`. Episode tracking is in `tracker.js` and `progress.js`. `config.js` holds the Client ID.
- `tests/` has the unit tests, and `tests/helpers/fakes.js` has a fake `browser` and a fake MyAnimeList for loading `main.js` in Node.
- `.github/` has the CI workflow and the issue forms.

## Tests and lint

```
npm test
npx --yes web-ext lint --source-dir .
```

`npm test` runs `node --test "tests/*.test.js"`, so there is nothing to install. `web-ext` is not a dependency. It is fetched when the command runs. The popup, the settings page and most of `main.js` are wiring and DOM code, and the tests don't cover them.

## CI

`.github/workflows/ci.yml` runs both commands on every push to `main` and on pull requests. Lint errors fail the job.

## How rules and templates work

A site rule is `{host, url, title?, episodeFrom}`. `host` matches the page's website exactly or any subdomain of it. `url` is an address template and `title` is an optional tab title template. `episodeFrom` is `"url"`, `"title"` or `"none"`. Templates are plain text with the blocks `{show}`, `{episode}` and `{anything}`. They are compiled to regular expressions in `src/lib/template.js`. Address templates run against the decoded path plus query. Title templates run against the tab title. A rule is only valid if its templates compile, its address has one `{show}`, and the template that holds the episode has one `{episode}`. Rules saved in an older format, without an address template, are removed from the stored settings when the background page starts.

Rules are learned from two pages. `learnRule` in `src/lib/learn.js` takes the episode 1 page and the episode 2 page and finds the part of the address that differs. It only counts as the episode if the two values are exactly 1 and 2, so an internal ID that goes from 136407 to 136408 is not mistaken for an episode. It does the same with the tab title. The part before the number that belongs to the site (`ep-`, `episode-`, `?ep=`) stays literal. The longest path piece, or a query value, that looks like a name becomes `{show}`. Other path pieces become `{anything}` if they have a digit. Query parameters that hold neither the show nor the episode are left out. If both the address and the title have the episode, the address is the source and the title template is kept for the show name and the cross-check. If only the title has it, the title is the source. If neither has it, the source is `none` and only the popup buttons work. The one-click "Enable on <host>" builds an address template the same way from a single page that looks like `/<slug>/ep-<n>` or `/<slug>/episode-<n>`, in `src/lib/one-click.js`.

When a rule has both an address and a title template, the address number wins. The cross-check is for an address number that can't be an episode: it is higher than MyAnimeList's total, or higher than 2000 when the total isn't known. If the title number fits, `pickEpisode` in `url-parser.js` uses the title number instead. If the title can't say yet, no episode is used. For rules whose episode comes from the title, the tab title is still the previous page's when the address changes, so the visit is only counted on a title or load event (`visitTrigger`).

Matching a page to an anime uses the address slug. A slug often ends in a site ID (`jujutsu-kaisen-2nd-season-78067`), but a real title can also end in a number (`mob-psycho-100`). The tracker searches MyAnimeList with the full slug first, then again without the last piece if that piece has a digit or an underscore. It only accepts a result on its own when exactly one entry has a title, English title or synonym that equals the search text after normalizing (case, punctuation and diacritics ignored). If the rule has a title template and the title matches, the show name from the title goes first, but only if it shares a word of three or more letters with the slug. A third guess, the slug without its last two pieces, only fills the candidate list. Long titles are cut to 64 characters for the search, and the comparison uses the whole text.

## Using your own MyAnimeList API client

The Client ID in `src/lib/config.js` belongs to the published add-on. A fork should use its own Client ID and its own add-on ID, because the sign-in redirect address depends on the add-on ID.

1. Set your own add-on ID in `manifest.json` (`browser_specific_settings.gecko.id`).
2. Load the add-on from `about:debugging`, click "Inspect", and run `browser.identity.getRedirectURL()` in the console. It prints the redirect address.
3. Register an app at <https://myanimelist.net/apiconfig>. Set App Type to "other" and App Redirect URL to the address from step 2.
4. Put the Client ID of that app in `src/lib/config.js` as `BUILT_IN_CLIENT_ID`.

If `BUILT_IN_CLIENT_ID` is empty, sign-in fails with "This build has no MyAnimeList Client ID. See DEVELOPING.md."

## Packaging

```
npx --yes web-ext build
```

This makes a zip in `web-ext-artifacts/`. Upload it to addons.mozilla.org for signing. The `webExt.ignoreFiles` list in `package.json` leaves out the tests and the Markdown files.
