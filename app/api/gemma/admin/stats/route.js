import { adminStats } from "../../../../../lib/gemma-store";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    if (!(await requireRole(request, ["ADMIN"]))) {
      return Response.json({ error: "Non autorizzato." }, { status: 401 });
    }
    return Response.json(await adminStats());
  } catch (error) {
    console.error("Gemma admin stats error", error);
    return Response.json({ error: "Statistiche non disponibili." }, { status: 500 });
  }
}
