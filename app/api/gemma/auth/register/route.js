import { authCookieForUser, createUser } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const user = await createUser({
      email: body?.email,
      name: body?.name,
      password: body?.password,
      role: "CUSTOMER",
    });
    const response = Response.json({ user }, { status: 201 });
    response.headers.set("set-cookie", authCookieForUser(user));
    return response;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Registrazione non riuscita." },
      { status: 400 },
    );
  }
}
