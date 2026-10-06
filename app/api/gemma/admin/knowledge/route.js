import { listKnowledgeDocuments } from "../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  if (!(await requireRole(request, ["ADMIN"]))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  const url = new URL(request.url);
  return Response.json({
    documents: await listKnowledgeDocuments({
      search: url.searchParams.get("search") || "",
      status: url.searchParams.get("status") || "ALL",
      limit: Number(url.searchParams.get("limit")) || 200,
    }),
    mode: "READ_ONLY",
  });
}
