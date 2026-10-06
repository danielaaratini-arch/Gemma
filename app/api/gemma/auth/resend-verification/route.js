import { after } from "next/server";
import {
  activeAuthSession,
  issueEmailVerification,
} from "../../../../../../lib/gemma-auth";
import { sendEmailVerification } from "../../../../../../lib/gemma-notifications";

export const runtime = "nodejs";

export async function POST(request) {
  const user = await activeAuthSession(request);
  if (!user || user.role !== "CUSTOMER") {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  if (user.emailVerified) {
    return Response.json({ sent: false, alreadyVerified: true });
  }

  const verification = await issueEmailVerification(user.id);
  if (!verification) {
    return Response.json(
      { error: "Verifica email non disponibile." },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  after(() =>
    sendEmailVerification({
      email: verification.user.email,
      name: verification.user.name,
      token: verification.token,
      origin,
    }),
  );

  return Response.json({ sent: true });
}
