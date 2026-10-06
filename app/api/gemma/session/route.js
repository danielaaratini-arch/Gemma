import {
  customerCookie,
  customerKeyFromRequest,
  ensureGemmaSchema,
} from "../../../../lib/gemma-store";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    await ensureGemmaSchema();
    const session = customerKeyFromRequest(request);
    const response = Response.json({ ok: true, customerSession: true });

    if (session.isNew) {
      response.headers.set("set-cookie", customerCookie(session.key));
    }

    return response;
  } catch (error) {
    console.error("Gemma session error", error);
    return Response.json({ error: "Sessione non disponibile." }, { status: 500 });
  }
}
