import {
  createMemory,
  deleteMemory,
  listMemory,
  updateMemory,
} from "../../../../../lib/gemma-admin";
import { requireRole } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

async function auth(request) {
  return await requireRole(request, ["ADMIN"]);
}

export async function GET(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  const url = new URL(request.url);
  const customerKey = url.searchParams.get("customerKey") || "";
  if (!customerKey) return Response.json({ memories: [] });
  return Response.json({ memories: await listMemory(customerKey) });
}

export async function POST(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  try {
    const body = await request.json();
    const memory = await createMemory({
      customerKey: body?.customerKey,
      value: body?.value,
      source: "ADMIN",
    });
    return Response.json({ memory }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Memoria non salvata." },
      { status: 400 },
    );
  }
}

export async function PATCH(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  try {
    const body = await request.json();
    const memory = await updateMemory(String(body?.id || ""), body?.value);
    if (!memory) return Response.json({ error: "Memoria non trovata." }, { status: 404 });
    return Response.json({ memory });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Memoria non aggiornata." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  if (!(await auth(request))) return Response.json({ error: "Non autorizzato." }, { status: 401 });
  const body = await request.json();
  const ok = await deleteMemory(String(body?.id || ""));
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Memoria non trovata." }, { status: 404 });
}
