import { after } from "next/server";
import {
  adoptAnonymousCustomer,
  authCookieForUser,
  createUser,
  issueEmailVerification,
} from "../../../../../lib/gemma-auth";
import { sendEmailVerification } from "../../../../../lib/gemma-notifications";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const user = await createUser({
      email: body?.email,
      name: body?.name,
      password: body?.password,
      role: "CUSTOMER",
      customerCode: body?.customerCode,
      serviceNumber: body?.serviceNumber,
    });

    await adoptAnonymousCustomer(request, user);

    const verification = await issueEmailVerification(user.id);
    if (verification) {
      const origin = new URL(request.url).origin;
      after(() =>
        sendEmailVerification({
          email: verification.user.email,
          name: verification.user.name,
          token: verification.token,
          origin,
        }),
      );
    }

    const response = Response.json(
      {
        user,
        emailVerificationSent: Boolean(verification),
      },
      { status: 201 },
    );
    response.headers.set("set-cookie", authCookieForUser(user));
    return response;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Registrazione non riuscita.",
      },
      { status: 400 },
    );
  }
}
