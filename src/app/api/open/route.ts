/**
 * An https link that opens the app. Emails need one: mail clients (Gmail
 * especially) strip or refuse custom-scheme links, but follow an https link
 * whose redirect then hands off to the `mneme://` scheme.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 302, headers: { Location: "mneme://" } });
}
