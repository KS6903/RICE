/** The Google OAuth client ID this build was given, or "" when Google sign-in isn't
 *  set up (as on a local stack). Read when called, not once at import, so a test
 *  can stub it. */
export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
}

/** Offer Google sign-in only when it is set up. Without a client ID, Google's button
 *  draws broken, can't sign anyone in, and fills the console with errors
 *  ("Missing required parameter: client_id"). */
export function googleSignInEnabled(): boolean {
  return googleClientId().length > 0;
}
