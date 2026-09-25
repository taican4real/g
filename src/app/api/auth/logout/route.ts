import { logout } from "@/server/auth/authentication";
import type { NextRequest } from "next/server";
import {
  sessionCookieName,
  sessionCookieOptions,
} from "@/server/auth/sessions";
import { clientMeta, jsonOk } from "@/server/shared/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const meta = clientMeta(request);
  const token = request.cookies.get(sessionCookieName())?.value ?? null;
  await logout({ token, ...meta });

  const response = jsonOk({ ok: true });
  response.cookies.set(sessionCookieName(), "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}