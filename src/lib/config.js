export const BUILT_IN_CLIENT_ID = "03b81ad622fe7237c37f1931afafb97e";
export const REPO_URL = "https://github.com/YourPlantDad/nextep";

// A user-supplied Client ID overrides the built-in one. The secret belongs to the user's own
// client, so it's never returned alongside the built-in ID.
export function resolveClient(settings, builtInClientId = BUILT_IN_CLIENT_ID) {
  const override = String(settings?.clientId ?? "").trim();
  if (override) {
    const secret = String(settings?.clientSecret ?? "").trim();
    return { clientId: override, clientSecret: secret || undefined };
  }
  return { clientId: builtInClientId, clientSecret: undefined };
}
