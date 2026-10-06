import {
  addTicketAttachments,
  customerCookie,
  customerKeyFromRequest,
} from "../../../../../../lib/gemma-store";
import {
  MAX_FILES_PER_UPLOAD,
  validateAttachment,
} from "../../../../../../lib/gemma-upload-rules";
import { requireRole } from "../../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request, context) {
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
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item) => item instanceof File);

    if (files.length === 0) {
      return Response.json({ error: "Nessun file selezionato." }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      return Response.json({ error: "Puoi caricare al massimo 5 file alla volta." }, { status: 400 });
    }

    for (const file of files) {
      const error = validateAttachment(file);
      if (error) return Response.json({ error }, { status: 400 });
    }

    const prepared = [];
    for (const file of files) {
      prepared.push({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        buffer: Buffer.from(await file.arrayBuffer()),
      });
    }

    const saved = await addTicketAttachments({
      ticketId: id,
      customerKey: staffView ? null : session.key,
      files: prepared,
      actorName: staffView ? (staff?.name || staff?.email || "Backoffice") : "Cliente",
    });

    if (!saved) {
      return Response.json({ error: "Ticket non trovato." }, { status: 404 });
    }

    const response = Response.json({ attachments: saved }, { status: 201 });
    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }
    return response;
  } catch (error) {
    console.error("Gemma attachment upload error", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Caricamento non riuscito." },
      { status: 500 },
    );
  }
}
