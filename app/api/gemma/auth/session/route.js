import {
  activeAuthSession,
  adminExists,
} from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  return Response.json({
    user: await activeAuthSession(request),
    adminExists: await adminExists(),
  });
}
