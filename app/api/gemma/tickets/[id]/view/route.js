import { randomUUID } from "node:crypto";
import { operationalDb } from "../../../../../../lib/db";
import { ensureGemmaSchema } from "../../../../../../lib/gemma-store";
import { requireRole } from "../../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request, context) {
  const user = requireRole(request, ["ADMIN", "OPERATOR"]);
  if (!user) return Response.json({ error: "Non autorizzato." }, { status: 401 });

  const { id } = await context.params;
  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) return Response.json({ error: "Database non disponibile." }, { status: 503 });

  const tickets = await sql.unsafe(
    "SELECT id FROM gemma.ticket WHERE id=$1 LIMIT 1",
    [id],
  );
  if (!tickets[0]) return Response.json({ error: "Ticket non trovato." }, { status: 404 });

  await sql.unsafe(
    "INSERT INTO gemma.ticket_event (id,ticket_id,type,description,actor_name,created_at) VALUES ($1,$2,'VIEWED','Ticket consultato',$3,now())",
    [randomUUID(), id, user.name || user.email || "Operatore"],
  );

  return Response.json({ ok: true });
}
