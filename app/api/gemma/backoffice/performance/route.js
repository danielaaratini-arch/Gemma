import { performanceStats } from "../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await requireRole(request, ["ADMIN", "OPERATOR"]);
  if (!user) return Response.json({ error: "Non autorizzato." }, { status: 401 });

  const all = await performanceStats();
  const mine = all.operators.find((item) => item.name === (user.name || user.email)) || {
    name: user.name || user.email || "Operatore",
    totalRatings: 0,
    average: null,
    distribution: { "1":0,"2":0,"3":0,"4":0,"5":0 },
  };

  return Response.json({ performance: mine });
}
