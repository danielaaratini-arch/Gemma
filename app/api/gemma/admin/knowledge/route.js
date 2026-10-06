import {
  createManualKnowledgeDocument,
  listKnowledgeDocuments,
} from "../../../../../lib/gemma-admin";
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
    mode: "ADMIN",
  });
}

export async function POST(request) {
  if (!(await requireRole(request, ["ADMIN"]))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const id = await createManualKnowledgeDocument(body || {});
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Documento Knowledge non creato.",
      },
      { status: 400 },
    );
  }
}
