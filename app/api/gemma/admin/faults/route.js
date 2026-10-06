import { deleteFault, listFaults, saveFault } from "../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

async function auth(request) {
  return await requireRole(request, ["ADMIN"]);
}

export async function GET(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  return Response.json({ faults: await listFaults() });
}

export async function POST(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  try {
    const body = await request.json();
    const fault = await saveFault(body || {});
    return Response.json({ fault }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Salvataggio non riuscito." },
      { status: 400 },
    );
  }
}

export async function PATCH(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  try {
    const body = await request.json();
    const fault = await saveFault(body || {});
    return Response.json({ fault });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Salvataggio non riuscito." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  const body = await request.json();
  const ok = await deleteFault(String(body?.id || ""));
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Alert non trovato." }, { status: 404 });
}
