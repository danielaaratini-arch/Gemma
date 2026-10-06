import { addTicketNote } from "../../../../../../lib/gemma-store";
import { requireRole } from "../../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request, context) {
  try {
    const staff = requireRole(request, ["ADMIN", "OPERATOR"]);
    if (!staff) {
      return Response.json({ error: "Non autorizzato." }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const note = await addTicketNote({
      ticketId: id,
      authorName: staff.name || staff.email || body?.authorName || "Operatore",
      content: body?.content,
    });

    return Response.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Gemma ticket note error", error);
    return Response.json({ error: "Nota non salvata." }, { status: 500 });
  }
}
