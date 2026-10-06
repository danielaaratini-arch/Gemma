import { verifyCustomerEmailToken } from "../../../../../../lib/gemma-auth";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const origin = url.origin;

  try {
    const user = await verifyCustomerEmailToken(token);
    if (!user) {
      return Response.redirect(origin + "/cliente?emailVerified=invalid", 302);
    }

    return Response.redirect(origin + "/cliente?emailVerified=1", 302);
  } catch (error) {
    console.error("Gemma verify email error", error);
    return Response.redirect(origin + "/cliente?emailVerified=error", 302);
  }
}
