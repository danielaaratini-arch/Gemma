import { adminExists, readAuthSession } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  return Response.json({
    user: readAuthSession(request),
    adminExists: await adminExists(),
  });
}
