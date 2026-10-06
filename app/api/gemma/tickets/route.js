import {
  createTicket,
  customerCookie,
  customerKeyFromRequest,
  listTickets,
} from "../../../../lib/gemma-store";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const session = customerKeyFromRequest(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const tickets = await listTickets({
      customerKey: scope === "all" ? null : session.key,
    });

    const response = Response.json({ tickets });
    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }
    return response;
  } catch (error) {
    console.error("Gemma tickets GET error", error);
    return Response.json({ error: "Ticket non disponibili." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = customerKeyFromRequest(request);
    const body = await request.json();
    const conversationId =
      typeof body?.conversationId === "string" ? body.conversationId.trim() : "";

    if (!conversationId) {
      return Response.json({ error: "Conversazione mancante." }, { status: 400 });
    }

    const ticket = await createTicket({
      conversationId,
      customerKey: session.key,
      customerName: body?.customerName,
    });

    const response = Response.json({ ticket }, { status: 201 });
    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }
    return response;
  } catch (error) {
    console.error("Gemma tickets POST error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Impossibile aprire il ticket." },
      { status: 500 },
    );
  }
}
