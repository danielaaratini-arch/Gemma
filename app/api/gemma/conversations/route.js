import { listConversations } from "../../../../lib/gemma-admin";
import { requireRole } from "../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  if (!(await requireRole(request, ["ADMIN", "OPERATOR"]))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }
  const url = new URL(request.url);
  return Response.json({
    conversations: await listConversations({
      limit: Number(url.searchParams.get("limit")) || 100,
      search: url.searchParams.get("search") || "",
    }),
  });
}
