import { after } from "next/server";
import {
  addTicketMessage,
  customerCookie,
  customerKeyFromRequest,
  getTicket,
  updateTicket,
} from "../../../../../../lib/gemma-store";
import { requireRole } from "../../../../../../lib/gemma-auth";
import { notifyTicketStatusChanged } from "../../../../../../lib/gemma-notifications";

export const runtime = "nodejs";

const REPLY_STATUSES = new Set([
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_DEPARTMENT",
  "RESOLVED",
]);

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const session = customerKeyFromRequest(request);
    const body = await request.json();
    const requestedRole = body?.role === "OPERATOR" ? "OPERATOR" : "CUSTOMER";

    if (requestedRole === "OPERATOR") {
      const staff = await requireRole(request, ["ADMIN", "OPERATOR"]);
      if (!staff) {
        return Response.json({ error: "Non autorizzato." }, { status: 401 });
      }

      const before = await getTicket(id, null);
      if (!before) {
        return Response.json({ error: "Ticket non trovato." }, { status: 404 });
      }

      const message = await addTicketMessage({
        ticketId: id,
        role: "OPERATOR",
        authorName: staff.name || staff.email || "Operatore",
        content: body?.content,
        customerKey: null,
      });

      if (!message) {
        return Response.json({ error: "Ticket non trovato." }, { status: 404 });
      }

      let ticket = before;
      const requestedStatus = String(body?.status || "").toUpperCase();

      if (REPLY_STATUSES.has(requestedStatus)) {
        ticket = await updateTicket(
          id,
          { status: requestedStatus, assignee: staff.name || staff.email || "Operatore" },
          staff.name || staff.email || "Operatore",
        );

        if (ticket && before.status !== ticket.status) {
          after(() => notifyTicketStatusChanged(ticket, before.status));
        }
      }

      return Response.json({ message, ticket }, { status: 201 });
    }

    const message = await addTicketMessage({
      ticketId: id,
      role: "CUSTOMER",
      authorName: body?.authorName || "Cliente",
      content: body?.content,
      customerKey: session.key,
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
