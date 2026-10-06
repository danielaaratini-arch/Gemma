import { saveRating } from "../../../../../../lib/gemma-admin";
import { customerContextFromRequest, getTicket } from "../../../../../../lib/gemma-store";

export const runtime = "nodejs";

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const session = await customerContextFromRequest(request);
    if (session.invalid) {
      return Response.json(
        { error: "Sessione cliente non valida. Accedi di nuovo." },
        { status: 401 },
      );
    }
    const ticket = await getTicket(id, session.key);
    if (!ticket) {
      return Response.json({ error: "Ticket non trovato." }, { status: 404 });
    }

    const body = await request.json();
    const rating = await saveRating({
      ticketId: id,
      score: body?.score,
      comment: body?.comment,
    });

    return Response.json({ rating }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Valutazione non salvata." },
      { status: 400 },
    );
  }
}
