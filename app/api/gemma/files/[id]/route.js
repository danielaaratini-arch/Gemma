import {
  customerCookie,
  customerKeyFromRequest,
  getTicketAttachment,
} from "../../../../../lib/gemma-store";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

function safeName(value) {
  return String(value || "allegato").replace(/[\r\n"]/g, "_");
}

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const staffView = url.searchParams.get("scope") === "staff";
    const staff = staffView
      ? await requireRole(request, ["ADMIN", "OPERATOR"])
      : null;

    if (staffView && !staff) {
      return Response.json({ error: "Non autorizzato." }, { status: 401 });
    }

    const session = customerKeyFromRequest(request);
    const file = await getTicketAttachment(id, staffView ? null : session.key);

    if (!file) {
      return Response.json({ error: "File non trovato." }, { status: 404 });
    }

    const response = new Response(file.content, {
      headers: {
        "content-type": file.content_type || "application/octet-stream",
        "content-length": String(file.size_bytes || file.content?.length || 0),
        "content-disposition": "inline; filename=\"" + safeName(file.original_name) + "\"",
        "cache-control": "private, no-store",
      },
    });

    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }
    return response;
  } catch (error) {
    console.error("Gemma attachment read error", error);
    return Response.json({ error: "File non disponibile." }, { status: 500 });
  }
}
