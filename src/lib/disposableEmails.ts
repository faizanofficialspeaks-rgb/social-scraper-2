// Disposable / temporary email domain guard (shared client-side list)
// Server-side enforcement lives in server.ts (isDisposableEmail).

export const DISPOSABLE_EMAIL_DOMAINS: string[] = [
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com',
  'temp-mail.org', 'tempmail.com', 'getnada.com', 'maildrop.cc', 'throwawaymail.com',
  'trashmail.com', 'mailnesia.com', 'spam4.me', 'fakemail.net', 'emailondeck.com',
  'disposablemail.com', 'tempinbox.com', '33mail.com', 'discards.email',
  'mailnator.com', 'tmail.ws', 'inboxbear.com', 'mintemail.com', 'mailcatch.com',
  'mytemp.email', 'tempail.com', 'temporary-mail.net', 'spamgourmet.com',
  'jetable.org', 'maildax.com', 'emailfake.com', 'fakeinbox.com', 'tempr.email',
  'inboxes.com', 'mailpoof.com', 'tempemail.net', 'luxusmail.org', 'altaddress.com',
  'hushmail.com', 'zoemail.org', 'anonaddy.com', 'moakt.com', 'dispostable.com',
  'mailsac.com', 'burnermail.io', 'expirebox.com', 'fleapost.com', 'grr.la',
  'ignoremail.com', 'mailnull.com', 'sogetthis.com', 'spamfree24.org',
  'throwaway.email', 'tempmailo.com', 'tmpmail.org', 'tempmail.dev',
  'onetimeusemail.com', 'one-time.email', 'sends.cf', 'dropmail.me',
];

export function isDisposableEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const domain = email.split('@')[1]?.toLowerCase() || '';
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) return true;
  // Catch wildcard subdomains (anything.mailinator.com etc.)
  return DISPOSABLE_EMAIL_DOMAINS.some((d) => domain.endsWith('.' + d));
}
