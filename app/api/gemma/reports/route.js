import { operationalDb } from "../../../../lib/db";
import { ensureGemmaSchema } from "../../../../lib/gemma-store";
import { requireRole } from "../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  if (!requireRole(request, ["ADMIN", "OPERATOR"])) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) {
    return Response.json({ error: "Database non disponibile." }, { status: 503 });
  }

  const [status, department, priority, daily] = await Promise.all([
    sql.unsafe(
      "SELECT status,count(*)::int AS count FROM gemma.ticket GROUP BY status ORDER BY count DESC",
    ),
    sql.unsafe(
      "SELECT coalesce(department,'OTHER') AS department,count(*)::int AS count FROM gemma.ticket GROUP BY coalesce(department,'OTHER') ORDER BY count DESC",
    ),
    sql.unsafe(
      "SELECT priority,count(*)::int AS count FROM gemma.ticket GROUP BY priority ORDER BY count DESC",
    ),
    sql.unsafe(
      "SELECT date_trunc('day',created_at)::date AS day,count(*)::int AS count FROM gemma.ticket WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1",
    ),
  ]);

  return Response.json({ status, department, priority, daily });
}
