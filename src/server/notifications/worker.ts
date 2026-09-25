import { withSystem } from "../db/client";
import { renderTemplate } from "./outbox";
import { getEmailProvider } from "./provider";

export async function processQueuedEmails(limit = 20): Promise<{ sent: number; deferred: number }> {
  let sent = 0;
  let deferred = 0;
  try {
    const provider = getEmailProvider();
    const notifications = await withSystem((tx) => tx`
      select n.id, n.recipient_email, n.template_code, n.template_version, n.payload,
        t.subject_template, t.html_template, t.text_template
      from notifications n
      join notification_templates t on t.code = n.template_code and t.version = n.template_version and t.active = true
      where n.status = 'queued' and n.available_at <= now()
      order by n.created_at
      limit ${limit}
      for update skip locked
    `);
    for (const notification of notifications) {
      try {
        const payload = notification.payload as Record<string, string>;
        const accepted = await provider.send({
          to: notification.recipient_email,
          subject: renderTemplate(notification.subject_template, payload),
          html: renderTemplate(notification.html_template, payload),
          text: renderTemplate(notification.text_template, payload),
        });
        if (!accepted.accepted) throw new Error("Email provider did not accept the message");
        await withSystem(async (tx) => {
          await tx`update notifications set status = 'sent', sent_at = now(), provider_message_id = ${accepted.providerMessageId ?? null}, attempts = attempts + 1 where id = ${notification.id}`;
          await tx`insert into email_logs (notification_id, provider, provider_message_id, status, response_message) values (${notification.id}, ${accepted.provider}, ${accepted.providerMessageId ?? null}, 'sent', 'Provider accepted the message')`;
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Email provider failed";
        await withSystem(async (tx) => {
          await tx`update notifications set status = 'queued', attempts = attempts + 1, available_at = now() + interval '5 minutes', last_error = ${message} where id = ${notification.id}`;
          await tx`insert into email_logs (notification_id, provider, status, response_message) values (${notification.id}, 'unconfigured', 'failed', ${message})`;
        });
        deferred += 1;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not configured")) return { sent, deferred };
    throw error;
  }
  return { sent, deferred };
}
