/**
 * Transactional email, behind the smallest abstraction that lets the provider
 * change later. Resend is the default (and only) implementation because no
 * other email infra exists yet: set RESEND_API_KEY and delivery starts —
 * that is the whole deploy step.
 *
 * Optional EMAIL_FROM overrides the sender ("mneme <team@mneme.app>" form).
 * The default is Resend's shared onboarding sender, which works without a
 * verified domain but should be replaced before launch.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

const DEFAULT_FROM = "mneme <onboarding@resend.dev>";

export function emailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Sends one email. Returns whether the message was handed to a provider —
 * `false` when no provider is configured, so callers can arrange a dev
 * fallback. Provider errors are logged (never with message contents) and
 * reported as not-delivered rather than thrown: every current caller must
 * respond identically whether or not an email went out.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "email_send_failed",
          status: response.status,
          // Body is provider diagnostics (invalid sender, quota) — safe to log,
          // and the only way to debug a misconfigured key from Render's logs.
          body: (await response.text()).slice(0, 500),
        }),
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "email_send_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
}
