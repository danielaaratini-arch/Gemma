import { updateManualKnowledgeDocument } from "../../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function PATCH(request, context) {
  if (!(await requireRole(request, ["ADMIN"]))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = await updateManualKnowledgeDocument(id, body || {});

    if (!updated) {
      return Response.json(
        { error: "Documento Knowledge non trovato." },
        { status: 404 },
      );
    }

    return Response.json({ id: updated });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Documento Knowledge non aggiornato.",
      },
      { status: 400 },
    );
  }
}
