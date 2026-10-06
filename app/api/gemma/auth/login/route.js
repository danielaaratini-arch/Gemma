import { authCookieForUser, authenticateUser } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json();
  const mode = ["CUSTOMER", "STAFF", "ADMIN"].includes(body?.mode)
    ? body.mode
    : "CUSTOMER";

  const user = await authenticateUser({
    email: body?.email,
    password: body?.password,
    mode,
  });

  if (!user) {
    return Response.json({ error: "Credenziali non valide." }, { status: 401 });
  }

  const response = Response.json({ user });
  response.headers.set("set-cookie", authCookieForUser(user));
  return response;
}
