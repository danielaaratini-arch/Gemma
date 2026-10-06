import { addTicketNote } from "../../../../../../lib/gemma-store";

export const runtime = "nodejs";

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const note = await addTicketNote({
      ticketId: id,
      authorName: body?.authorName || "Operatore Demo",
      content: body?.content,
    });

    return Response.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Gemma ticket note error", error);
    return Response.json({ error: "Nota non salvata." }, { status: 500 });
  }
}
