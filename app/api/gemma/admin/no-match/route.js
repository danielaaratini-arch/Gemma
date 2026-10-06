import { requireRole } from "../../../../../lib/gemma-auth";
import { listNoMatches } from "../../../../../lib/gemma-no-match";

export const runtime = "nodejs";

export async function GET(request) {
  if (!requireRole(request, ["ADMIN"])) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || 300;

  return Response.json({
    noMatches: await listNoMatches(limit),
    definition: "knowledgeHits = 0",
  });
}
