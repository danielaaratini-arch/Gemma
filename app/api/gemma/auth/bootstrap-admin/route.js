import { adminExists, authCookieForUser, createUser } from "../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    if (await adminExists()) {
      return Response.json(
        { error: "Amministratore già configurato." },
        { status: 409 },
      );
    }

    const body = await request.json();
    const user = await createUser({
      email: body?.email,
      name: body?.name,
      password: body?.password,
      role: "ADMIN",
    });

    const response = Response.json({ user }, { status: 201 });
    response.headers.set("set-cookie", authCookieForUser(user));
    return response;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Configurazione non riuscita.",
      },
      { status: 400 },
    );
  }
}
