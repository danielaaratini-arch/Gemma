import { clearAuthCookie } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set("set-cookie", clearAuthCookie());
  return response;
}
