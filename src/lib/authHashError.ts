// Supabase redirects expired/invalid email links back with `#error=...` in
// the hash. Its target depends on the project's Site URL / Redirect URL
// config, so this can land on any page - not just /login or /signup, which
// are the only pages that know how to display it.
const REDIRECT_ERROR_KEY = 'clade-auth-redirect-error';

export function parseAuthHashError(hash: string): string | null {
  if (!hash.startsWith('#error=')) return null;
  try {
    const params = new URLSearchParams(hash.slice(1));
    const errorCode = params.get('error_code');
    const errorDescription = params.get('error_description');
    const isExpiredLink =
      errorCode === 'otp_expired' ||
      (errorCode === 'access_denied' &&
        !!errorDescription &&
        errorDescription.toLowerCase().includes('email link'));
    return isExpiredLink ? errorDescription || 'Your confirmation link has expired.' : null;
  } catch {
    return null;
  }
}

export function stashAuthRedirectError(message: string) {
  try {
    sessionStorage.setItem(REDIRECT_ERROR_KEY, message);
  } catch {
    // sessionStorage unavailable (e.g. private mode) - the message just won't survive the redirect
  }
}

export function consumeAuthRedirectError(): string | null {
  try {
    const message = sessionStorage.getItem(REDIRECT_ERROR_KEY);
    if (message) sessionStorage.removeItem(REDIRECT_ERROR_KEY);
    return message;
  } catch {
    return null;
  }
}
