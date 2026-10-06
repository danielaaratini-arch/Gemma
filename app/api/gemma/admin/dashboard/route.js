import { adminDashboard } from "../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  if (!(await requireRole(request, ["ADMIN"]))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }
  return Response.json(await adminDashboard());
}
