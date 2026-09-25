import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads `.env.local` (then `.env`) for scripts that run outside the Next.js
 * runtime, which does not auto-load dotfiles. Existing environment variables
 * win.
 */
export function loadEnv(): void {
  const candidates = [join(process.cwd(), ".env.local"), join(process.cwd(), ".env")];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        if (typeof process.loadEnvFile === "function") {
          process.loadEnvFile(file);
        }
        return;
      } catch {
        // malformed file; continue to next candidate
      }
    }
  }
}