import type { Sql } from "../db/client";

export type NotificationPayload = Record<string, string>;

export async function queueEmail(tx: Sql, input: {
  tenantId?: string | null;
  userId?: string | null;
  recipientEmail: string;
  notificationType: string;
  templateCode: string;
  payload: NotificationPayload;
}): Promise<{ notificationId: string }> {
  const [notification] = await tx`
    insert into notifications (
      tenant_id, user_id, notification_type, recipient_email,
      template_code, payload, status
    ) values (
      ${input.tenantId ?? null}, ${input.userId ?? null}, ${input.notificationType}, ${input.recipientEmail},
      ${input.templateCode}, ${tx.json(input.payload)}, 'queued'
    ) returning id
  `;
  await tx`
    insert into email_logs (notification_id, provider, status, response_message)
    values (${notification.id}, 'outbox', 'queued', 'Waiting for a configured email provider')
  `;
  return { notificationId: notification.id };
}

export function renderTemplate(template: string, payload: NotificationPayload): string {
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key: string) => payload[key] ?? "");
}
