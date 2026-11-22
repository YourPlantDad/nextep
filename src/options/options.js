import { REPO_URL } from "../lib/config.js";

const $ = (id) => document.getElementById(id);
const send = (message) => browser.runtime.sendMessage(message);

let signedIn = false;
let userName = null;

const CHANGED_ELSEWHERE = "Settings were changed somewhere else. Reload this page before saving.";

// Edits in the form that are not saved yet.
let dirty = false;
// Why Save is off, or "" when it is on. Saving then could overwrite settings with a stale or empty form.
let blockReason = "";
// The settings as last loaded or saved, to tell this page's own saves from changes made elsewhere.
let baseline = "";
let saving = false;

function markDirty() {
  dirty = true;
}

function block(reason) {
  blockReason = reason;
  $("save").disabled = true;
  showError(reason);
}

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
  const host = input("website, e.g. example.tv", rule.host);
  const url = input("/watch/{show}/ep-{episode}", rule.url);
  const title = input("{show} Episode {episode}{anything}", rule.title);
  const from = document.createElement("select");
  for (const [value, text] of SOURCES) from.append(new Option(text, value));
  from.value = rule.episodeFrom ?? "url";
  const row = document.createElement("div");
  row.className = "fields";
  row.append(
    field("Website", host),
    field("Address template", url),
    field("Tab title template (optional)", title),
    field("Episode number from", from),
  );
  row.host = host;
  row.collect = () => ({
    host: host.value,
    url: url.value,
    title: title.value,
    episodeFrom: from.value,
  });
  return row;
}

function patternRow(rule) {
  const host = input("website, e.g. example.tv", rule.host);
  const pattern = input("pattern with (?<slug>) and (?<ep>)", rule.pattern);
  const row = document.createElement("div");
  row.className = "fields";
  row.append(field("Website", host), field("Regex pattern", pattern));
  row.host = host;
  row.collect = () => ({ host: host.value, pattern: pattern.value });
  return row;
}

// One collapsible entry. The summary shows the website and follows the field as you type.
function siteRow(rule, { open = false } = {}) {
  const fields = rule.url !== undefined ? templateRow(rule) : patternRow(rule);
  const entry = document.createElement("details");
  entry.className = "site";
  entry.open = open;
  const summary = document.createElement("summary");
  const showName = () => {
    summary.textContent = fields.host.value.trim() || "New website";
  };
  showName();
  fields.host.addEventListener("input", showName);
  fields.append(
    Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "Remove",
      onclick: () => {
        entry.remove();
        markDirty();
      },
    }),
  );
  entry.append(summary, fields);
  entry.collect = fields.collect;
  entry.websiteName = () => fields.host.value.trim().toLowerCase();
  return entry;
}

// A validation message starts with the website's name. Open that entry, or all of them
// if none matches.
function openForError(text) {
  const entries = [...$("sites").children];
  const named = entries.filter((e) => e.websiteName() && text.startsWith(e.websiteName() + ":"));
  for (const e of named.length > 0 ? named : entries) e.open = true;
}

function collect() {
  return {
    clientId: $("clientId").value,
    clientSecret: $("clientSecret").value,
    openOnRecord: $("openOnRecord").checked,
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
    if (!res.ok) {
      showError(res.error);
      openForError(res.error ?? "");
    }
    return res;
  } catch (e) {
    showError(e.message ?? String(e));
    return { ok: false };
  } finally {
    button.disabled = button === $("save") && Boolean(blockReason);
  }
}

async function refreshStatus() {
  let state;
  try {
    state = await send({ type: "getAccount" });
  } catch {
    state = { ok: false };
  }
  signedIn = Boolean(state.ok && state.signedIn);
  userName = signedIn ? (state.name ?? null) : null;
  paintAuth();
}

// Fills the form from storage. Returns false, with Save off, when that fails.
async function loadForm() {
  let res;
  try {
    res = await send({ type: "getSettings" });
  } catch (e) {
    res = { ok: false, error: e?.message ?? String(e) };
  }
  if (!res?.ok) {
    block(res?.error || "The settings couldn't be loaded. Reload this page.");
    return false;
  }
  const { settings } = res;
  $("clientId").value = settings.clientId;
  $("clientSecret").value = settings.clientSecret;
  $("openOnRecord").checked = settings.openOnRecord !== false;
  $("sites").replaceChildren(...settings.sites.map((rule) => siteRow(rule)));
  // Only open this up front if the build has no built-in ID.
  $("ownClient").open = !res.hasBuiltInClientId;
  if (!res.hasBuiltInClientId) {
    $("ownClientTitle").textContent = "Set up your own MyAnimeList API client";
  }
  $("noBuiltIn").hidden = res.hasBuiltInClientId;
  baseline = JSON.stringify(settings);
  dirty = false;
  blockReason = "";
  $("save").disabled = false;
  showError("");
  return true;
}

async function save() {
  if (blockReason) return { ok: false, error: blockReason };
  saving = true;
  try {
    const res = await send({ type: "saveSettings", settings: collect() });
    if (res.ok) {
      // Shows the saved values, and makes them the baseline for changes made elsewhere.
      await loadForm();
      $("message").textContent = res.signedOut
        ? "Saved. You were signed out because the Client ID changed."
        : "Saved.";
      if (res.signedOut) await refreshStatus();
    }
    return res;
  } finally {
    saving = false;
  }
}

// Another page (the popup, say) changed the settings while this one is open.
async function onSettingsChanged() {
  const res = await send({ type: "getSettings" });
  if (!res.ok || JSON.stringify(res.settings) === baseline) return;
  if (dirty) block(CHANGED_ELSEWHERE);
  else await loadForm();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings || saving) return;
  onSettingsChanged().catch(() => {});
});

$("save").addEventListener("click", (e) => run(e.target, save));

document.addEventListener("input", markDirty);
document.addEventListener("change", markDirty);

$("addSite").addEventListener("click", () => {
  const entry = siteRow({ host: "", url: "", title: "", episodeFrom: "url" }, { open: true });
  $("sites").append(entry);
  markDirty();
  entry.querySelector("input").focus();
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

await loadForm();
try {
  const redirect = await send({ type: "getRedirectUrl" });
  if (redirect.ok) $("redirect").value = redirect.url;
} catch {
  // The redirect address is only shown for copying.
}
await refreshStatus();
