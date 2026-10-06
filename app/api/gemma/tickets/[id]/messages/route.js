import {
  addTicketMessage,
  customerCookie,
  customerKeyFromRequest,
} from "../../../../../../lib/gemma-store";

export const runtime = "nodejs";

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const session = customerKeyFromRequest(request);
    const body = await request.json();
    const requestedRole = body?.role === "OPERATOR" ? "OPERATOR" : "CUSTOMER";

    const message = await addTicketMessage({
      ticketId: id,
      role: requestedRole,
      authorName:
        requestedRole === "CUSTOMER"
          ? body?.authorName || "Cliente"
          : body?.authorName || "Operatore Demo",
      content: body?.content,
      customerKey: requestedRole === "CUSTOMER" ? session.key : null,
    });

    if (!message) {
      return Response.json({ error: "Ticket non trovato." }, { status: 404 });
    }

    const response = Response.json({ message }, { status: 201 });
    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }
    return response;
  } catch (error) {
    console.error("Gemma ticket message error", error);
    return Response.json({ error: "Messaggio non inviato." }, { status: 500 });
  }
}
