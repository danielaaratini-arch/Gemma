import { parseKnowledgeUpload } from "../../../../../../lib/gemma-document-parser";
import { requireRole } from "../../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request) {
  if (!(await requireRole(request, ["ADMIN"]))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const parsed = await parseKnowledgeUpload(formData.get("file"));

    return Response.json({ document: parsed });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Documento Knowledge non leggibile.",
      },
      { status: 400 },
    );
  }
}
