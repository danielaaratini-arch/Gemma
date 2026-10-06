import {
  createTicket,
  customerCookie,
  customerKeyFromRequest,
  listTickets,
} from "../../../../lib/gemma-store";

export const runtime = "nodejs";

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    if (!decoded?.updatedAt || !decoded?.id) return null;
    return {
      updatedAt: String(decoded.updatedAt),
      id: String(decoded.id),
    };
  } catch {
    return null;
  }
}

function encodeCursor(ticket) {
  if (!ticket?.updated_at || !ticket?.id) return null;
  return Buffer.from(
    JSON.stringify({
      updatedAt: ticket.updated_at,
      id: ticket.id,
    }),
  ).toString("base64url");
}

export async function GET(request) {
  try {
    const session = customerKeyFromRequest(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const limit = Math.max(
      1,
      Math.min(100, Number(url.searchParams.get("limit")) || 50),
    );
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    const tickets = await listTickets({
      customerKey: scope === "all" ? null : session.key,
      limit: limit + 1,
      cursor,
    });

    const hasMore = tickets.length > limit;
    const visible = hasMore ? tickets.slice(0, limit) : tickets;
    const nextCursor = hasMore
      ? encodeCursor(visible[visible.length - 1])
      : null;

    const response = Response.json({
      tickets: visible,
      nextCursor,
    });
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
      requestKey:
        typeof body?.requestKey === "string"
          ? body.requestKey
          : undefined,
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
