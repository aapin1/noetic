/**
 * An https link that opens the app. Emails need one: mail clients (Gmail
 * especially) strip or refuse custom-scheme links, but follow an https link
 * whose redirect then hands off to the `mneme://` scheme.
 *
 * Only on a phone, though. Clicked on a computer the scheme goes nowhere, so
 * that gets a page saying where Mneme lives instead of a dead link.
 */
export const dynamic = "force-dynamic";

const APP_STORE_URL = "https://apps.apple.com/us/app/mneme-your-brain-mapped/id6791384175";

export function GET(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) {
    return new Response(null, { status: 302, headers: { Location: "mneme://" } });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Mneme</title><style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#252119;background:#faf8f3}a{color:#252119}</style></head><body><p>Mneme lives on your iPhone. Open this link from the email on your phone to go straight to the app.</p><p>Don't have it there? <a href="${APP_STORE_URL}">Get Mneme on the App Store</a>.</p></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
