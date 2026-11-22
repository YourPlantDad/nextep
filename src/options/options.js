import { REPO_URL } from "../lib/config.js";

const $ = (id) => document.getElementById(id);
const send = (message) => browser.runtime.sendMessage(message);

let signedIn = false;

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

function siteRow(rule) {
  const host = Object.assign(document.createElement("input"), {
    type: "text",
    placeholder: "host, e.g. example.tv",
    value: rule.host,
  });
  const pattern = Object.assign(document.createElement("input"), {
    type: "text",
    placeholder: "pattern with (?<slug>) and (?<ep>)",
    value: rule.pattern,
    spellcheck: false,
  });
  const remove = Object.assign(document.createElement("button"), {
    type: "button",
    textContent: "Remove",
    onclick: () => row.remove(),
  });
  const row = document.createElement("div");
  row.className = "site";
  row.append(host, pattern, remove);
  return row;
}

function collect() {
  return {
    clientId: $("clientId").value,
    clientSecret: $("clientSecret").value,
    notifications: $("notifications").checked,
    sites: [...$("sites").children].map((row) => ({
      host: row.children[0].value,
      pattern: row.children[1].value,
    })),
  };
}

function paintAuth() {
  $("auth").textContent = signedIn ? "Sign out" : "Sign in";
  $("status").textContent = signedIn ? "Signed in to MyAnimeList." : "Not signed in.";
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
  const state = await send({ type: "getState", url: "" });
  signedIn = Boolean(state.ok && state.signedIn);
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
  $("sites").append(siteRow({ host: "", pattern: "" }));
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
