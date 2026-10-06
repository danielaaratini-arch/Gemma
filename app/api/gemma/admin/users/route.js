import {
  createInternalUser,
  deleteInternalUser,
  listInternalUsers,
  updateInternalUser,
} from "../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

function unauthorized() {
  return Response.json({ error: "Accesso riservato agli amministratori." }, { status: 401 });
}

export async function GET(request) {
  if (!(await requireRole(request, ["ADMIN"]))) return unauthorized();
  return Response.json({ users: await listInternalUsers() });
}

export async function POST(request) {
  if (!(await requireRole(request, ["ADMIN"]))) return unauthorized();
  try {
    const body = await request.json();
    const user = await createInternalUser(body || {});
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Creazione non riuscita." },
      { status: 400 },
    );
  }
}

export async function PATCH(request) {
  if (!(await requireRole(request, ["ADMIN"]))) return unauthorized();
  try {
    const body = await request.json();
    const user = await updateInternalUser(String(body?.id || ""), body || {});
    if (!user) return Response.json({ error: "Utente non trovato." }, { status: 404 });
    return Response.json({ user });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Modifica non riuscita." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  if (!(await requireRole(request, ["ADMIN"]))) return unauthorized();
  const body = await request.json();
  const ok = await deleteInternalUser(String(body?.id || ""));
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Utente non trovato." }, { status: 404 });
}
