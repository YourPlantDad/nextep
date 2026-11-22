import { REPO_URL } from "../lib/config.js";

const $ = (id) => document.getElementById(id);
const send = (message) => browser.runtime.sendMessage(message);

let signedIn = false;
let userName = null;

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

function input(placeholder, value) {
  return Object.assign(document.createElement("input"), {
    type: "text",
    placeholder,
    value: value ?? "",
    spellcheck: false,
  });
}

function field(text, control) {
  const label = document.createElement("label");
  label.append(text, control);
  return label;
}

const SOURCES = [
  ["url", "address"],
  ["title", "tab title"],
  ["none", "nowhere (manual)"],
];

function templateRow(rule) {
  const host = input("host, e.g. example.tv", rule.host);
  const url = input("/watch/{show}/ep-{episode}", rule.url);
  const title = input("{show} Episode {episode}{anything}", rule.title);
  const from = document.createElement("select");
  for (const [value, text] of SOURCES) from.append(new Option(text, value));
  from.value = rule.episodeFrom ?? "url";
  const row = document.createElement("div");
  row.className = "site";
  row.append(
    field("Host", host),
    field("Address template", url),
    field("Tab title template (optional)", title),
    field("Episode number from", from),
  );
  row.collect = () => ({
    host: host.value,
    url: url.value,
    title: title.value,
    episodeFrom: from.value,
  });
  return row;
}

function patternRow(rule) {
  const host = input("host, e.g. example.tv", rule.host);
  const pattern = input("pattern with (?<slug>) and (?<ep>)", rule.pattern);
  const row = document.createElement("div");
  row.className = "site";
  row.append(field("Host", host), field("Regex pattern", pattern));
  row.collect = () => ({ host: host.value, pattern: pattern.value });
  return row;
}

function siteRow(rule) {
  const row = rule.url !== undefined ? templateRow(rule) : patternRow(rule);
  row.append(
    Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "Remove",
      onclick: () => row.remove(),
    }),
  );
  return row;
}

function collect() {
  return {
    clientId: $("clientId").value,
    clientSecret: $("clientSecret").value,
    notifications: $("notifications").checked,
    sites: [...$("sites").children].map((row) => row.collect()),
  };
}

function paintAuth() {
  $("auth").textContent = signedIn ? "Sign out" : "Sign in";
  $("status").textContent = !signedIn
    ? "Not signed in."
    : userName
      ? `Signed in as ${userName}.`
      : "Signed in to MyAnimeList.";
}

async function run(button, fn) {
  button.disabled = true;
  showError("");
  $("message").textContent = "";
  try {
    const res = await fn();
    if (!res.ok) showError(res.error);
    return res;
  } catch (e) {
    showError(e.message ?? String(e));
    return { ok: false };
  } finally {
    button.disabled = false;
  }
}

async function refreshStatus() {
  const state = await send({ type: "getAccount" });
  signedIn = Boolean(state.ok && state.signedIn);
  userName = signedIn ? (state.name ?? null) : null;
  paintAuth();
}

async function save() {
  const res = await send({ type: "saveSettings", settings: collect() });
  if (res.ok) {
    $("message").textContent = res.signedOut
      ? "Saved. You were signed out because the Client ID changed."
      : "Saved.";
    if (res.signedOut) await refreshStatus();
  }
  return res;
}

$("save").addEventListener("click", (e) => run(e.target, save));

$("addSite").addEventListener("click", () => {
  $("sites").append(siteRow({ host: "", url: "", title: "", episodeFrom: "url" }));
});

$("testNote").addEventListener("click", async (e) => {
  const button = e.target;
  button.disabled = true;
  $("noteResult").textContent = "";
  try {
    const res = await send({ type: "testNotification" });
    $("noteResult").textContent =
      res.ok && res.sent
        ? "Sent. If nothing popped up, check Windows notification settings for Firefox."
        : `Couldn't send it: ${res.error ?? "unknown error"}`;
  } catch (err) {
    $("noteResult").textContent = `Couldn't send it: ${err.message ?? String(err)}`;
  } finally {
    button.disabled = false;
  }
});

$("copy").addEventListener("click", () => navigator.clipboard.writeText($("redirect").value));

$("auth").addEventListener("click", (e) =>
  run(e.target, async () => {
    if (signedIn) {
      await send({ type: "signOut" });
    } else {
      // Sign-in reads settings from storage, so save the form first.
      const saved = await save();
      if (!saved.ok) return saved;
      const res = await send({ type: "signIn" });
      if (!res.ok) return res;
    }
    await refreshStatus();
    return { ok: true };
  }),
);

$("privacy").href = `${REPO_URL}/blob/main/PRIVACY.md`;
$("report").href = `${REPO_URL}/issues/new/choose`;

const [settings, redirect] = await Promise.all([
  send({ type: "getSettings" }),
  send({ type: "getRedirectUrl" }),
]);
if (settings.ok) {
  $("clientId").value = settings.settings.clientId;
  $("clientSecret").value = settings.settings.clientSecret;
  $("notifications").checked = settings.settings.notifications !== false;
  $("sites").replaceChildren(...settings.settings.sites.map(siteRow));
  // Only open this up front if the build has no built-in ID.
  $("advanced").open = !settings.hasBuiltInClientId;
  $("noBuiltIn").hidden = settings.hasBuiltInClientId;
} else showError(settings.error);
if (redirect.ok) $("redirect").value = redirect.url;
await refreshStatus();
