// Fills a demo episode page. The page has a title and an address like a streaming site's, and no video.
import { SITE_NAME, showFromPath, episodeFromLocation, pageTitle, episodeAddress } from "./shows.js";

// Links are built from where this file is, so the site works under any base path.
const root = new URL("./", import.meta.url);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const href = (address) => new URL(address, root).href;
const link = (text, address) => el("a", { href: href(address), textContent: text });

function fillPage(show, episode) {
  const nav = el("p", { className: "nav" });
  if (episode > 1) nav.append(link("Previous episode", episodeAddress(show, episode - 1)));
  if (episode < show.total) nav.append(link("Next episode", episodeAddress(show, episode + 1)));

  document.getElementById("app").replaceChildren(
    el("h1", { textContent: show.name }),
    el("p", { className: "episode", textContent: `Episode ${episode} of ${show.total}` }),
    nav,
    el("p", { className: "note", textContent: "This is a demo page. There is no video here." }),
    el("p", {}, [link("Back to the start page", "./")]),
  );
}

function run() {
  const show = showFromPath(location.pathname);
  const episode = show ? episodeFromLocation(location, show) : null;
  if (!show || episode === null) {
    document.title = SITE_NAME;
    document.getElementById("app").replaceChildren(
      el("h1", { textContent: "No such page" }),
      el("p", {}, [link("Back to the start page", "./")]),
    );
    return;
  }
  // Set before the page finishes loading, so the tab title is right when NextEp reads it.
  document.title = pageTitle(show, episode);
  fillPage(show, episode);
}

run();
