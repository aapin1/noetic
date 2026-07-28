/**
 * Public-facing URLs. App Store review checks that the privacy policy and terms
 * are reachable FROM INSIDE the binary (Guideline 3.1.2 for the subscription
 * screen, 5.1.1 for the account surfaces), so these are linked from the paywall,
 * settings, and sign-up rather than living only on the marketing site.
 */
export const WEBSITE_URL = 'https://mneme-app.com';
export const PRIVACY_URL = `${WEBSITE_URL}/privacy.html`;
export const TERMS_URL = `${WEBSITE_URL}/terms.html`;
export const SUPPORT_URL = `${WEBSITE_URL}/support.html`;
export const SUPPORT_EMAIL = 'mneme.help@gmail.com';
