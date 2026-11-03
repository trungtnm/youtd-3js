// Transactional email through Brevo, plus the daily send counter behind the email pause.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
export const EMAIL_PAUSE_AT = 0.9;

const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const cap = (env) => Number(env.EMAIL_DAILY_CAP) || 300;

export async function emailsPaused(env) {
  const row = await env.DB.prepare('SELECT emails FROM usage_daily WHERE day = ?').bind(day()).first();
  return (row?.emails || 0) >= Math.floor(cap(env) * EMAIL_PAUSE_AT);
}

export const countEmail = (env) => env.DB.prepare(
  'INSERT INTO usage_daily (day, emails) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET emails = emails + 1',
).bind(day()).run();

// Throws on any failure; the caller decides what the client sees. The message never
// includes the address or the API key.
export async function sendMail(env, { to, subject, html, text }, fetchImpl = fetch) {
  if (!env.BREVO_API_KEY) throw new Error('mail not configured');
  const res = await fetchImpl(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'YouTD Reforged' },
      to: [{ email: to }], subject, htmlContent: html, textContent: text,
    }),
  });
  if (!res.ok) throw new Error(`brevo responded ${res.status}`);
}

export function magicLinkMail(link) {
  return {
    subject: 'Your YouTD Reforged sign-in link',
    text: `Open this link to sign in (valid for 15 minutes, works once):\n${link}\n\nIf you did not ask for it, ignore this email.`,
    html: `<p>Open this link to sign in. It is valid for 15 minutes and works once.</p><p><a href="${link}">Sign in to YouTD Reforged</a></p><p>If you did not ask for it, ignore this email.</p>`,
  };
}
