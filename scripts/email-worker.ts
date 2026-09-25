import { loadEnv } from "./env";
import { processQueuedEmails } from "../src/server/notifications/worker";

loadEnv();

processQueuedEmails()
  .then((summary) => {
    console.log(`Email worker complete: ${summary.sent} sent, ${summary.deferred} deferred`);
  })
  .catch((error) => {
    console.error("Email worker failed:", error);
    process.exitCode = 1;
  });
