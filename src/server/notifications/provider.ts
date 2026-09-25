export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailAccepted = {
  accepted: true;
  provider: string;
  providerMessageId?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailAccepted>;
}

class DevelopmentEmailProvider implements EmailProvider {
  async send(): Promise<EmailAccepted> {
    throw new Error("EMAIL_PROVIDER is not configured; message remains queued");
  }
}

/** Provider selection is isolated here; business workflows never name a vendor. */
export function getEmailProvider(): EmailProvider {
  switch ((process.env.EMAIL_PROVIDER ?? "development").toLowerCase()) {
    case "development":
    case "console":
      return new DevelopmentEmailProvider();
    default:
      throw new Error("Configured email provider adapter is not installed");
  }
}
