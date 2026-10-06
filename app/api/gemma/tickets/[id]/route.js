import {
  customerCookie,
  customerKeyFromRequest,
  getTicket,
  updateTicket,
} from "../../../../../lib/gemma-store";
import { notifyTicketStatusChanged } from "../../../../../lib/gemma-notifications";

export const runtime = "nodejs";

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const session = customerKeyFromRequest(request);
    const url = new URL(request.url);
    const staff = url.searchParams.get("scope") === "staff";

    const ticket = await getTicket(id, staff ? null : session.key);
    if (!ticket) {
      return Response.json({ error: "Ticket non trovato." }, { status: 404 });
    }

    const response = Response.json({ ticket });
    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }
    return response;
  } catch (error) {
    console.error("Gemma ticket GET error", error);
    return Response.json({ error: "Ticket non disponibile." }, { status: 500 });
  }
}

export async function PATCH(request, context) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const before = await getTicket(id, null);
    const ticket = await updateTicket(
      id,
      body || {},
      body?.actor || "Operatore Demo",
    );

    if (!ticket) {
      return Response.json({ error: "Ticket non trovato." }, { status: 404 });
    }

    if (before && before.status !== ticket.status) {
      await notifyTicketStatusChanged(ticket, before.status);
    }

    return Response.json({ ticket });
  } catch (error) {
    console.error("Gemma ticket PATCH error", error);
    return Response.json({ error: "Aggiornamento non riuscito." }, { status: 500 });
  }
}
