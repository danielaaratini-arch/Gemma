import { after } from "next/server";
import {
  customerCookie,
  customerKeyFromRequest,
  getTicket,
  updateTicket,
} from "../../../../../lib/gemma-store";
import { notifyTicketStatusChanged } from "../../../../../lib/gemma-notifications";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const session = customerKeyFromRequest(request);
    const url = new URL(request.url);
    const staffView = url.searchParams.get("scope") === "staff";
    const staff = staffView
      ? await requireRole(request, ["ADMIN", "OPERATOR"])
      : null;

    if (staffView && !staff) {
      return Response.json({ error: "Non autorizzato." }, { status: 401 });
    }

    const ticket = await getTicket(id, staffView ? null : session.key);
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
    const staff = await requireRole(request, ["ADMIN", "OPERATOR"]);
    if (!staff) {
      return Response.json({ error: "Non autorizzato." }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const before = await getTicket(id, null);
    const ticket = await updateTicket(
      id,
      body || {},
      staff.name || staff.email || body?.actor || "Operatore",
    );

    if (!ticket) {
      return Response.json({ error: "Ticket non trovato." }, { status: 404 });
    }

    if (before && before.status !== ticket.status) {
      after(() => notifyTicketStatusChanged(ticket, before.status));
    }

    return Response.json({ ticket });
  } catch (error) {
    console.error("Gemma ticket PATCH error", error);
    return Response.json({ error: "Aggiornamento non riuscito." }, { status: 500 });
  }
}
