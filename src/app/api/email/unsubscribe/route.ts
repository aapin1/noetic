import { prisma } from "@/lib/prisma";
import { verifyUnsubscribe } from "@/server/services/first-capture-email";

/**
 * The unsubscribe link in the first-capture emails. No session: the link is
 * signed per user (services/first-capture-email.ts).
 *
 * GET only shows a button. Mail scanners and link previews fetch GET URLs on
 * their own, and an unsubscribe that fires on a prefetch would turn off email
 * for people who never asked. The change happens on POST, which is both the
 * button on that page and the RFC 8058 one-click request mail apps send from
 * the List-Unsubscribe header.
 */
export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#252119;background:#faf8f3}button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #252119;background:#252119;color:#faf8f3}</style></head><body>${body}</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const INVALID = () => page("Link not valid", "<p>This unsubscribe link isn't valid. Use the link in the most recent email from Mneme.</p>", 400);

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!verifyUnsubscribe(url.searchParams.get("u"), url.searchParams.get("t"))) return INVALID();
  // Posts back to this exact URL, signature and all.
  return page(
    "Unsubscribe",
    `<p>Stop getting reminder emails from Mneme?</p><form method="post"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u");
  if (!verifyUnsubscribe(userId, url.searchParams.get("t")) || !userId) return INVALID();
  try {
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, emailNudges: false },
      update: { emailNudges: false },
    });
  } catch {
    // A signed id whose account has since been deleted: nothing left to email.
  }
  return page("Unsubscribed", "<p>Done. Mneme won't send you reminder emails.</p>");
}
