import {
  removePushSubscription,
  savePushSubscription,
  webPushPublicConfig,
} from "../../../../lib/gemma-push";
import { activeAuthSession, userCustomerKey } from "../../../../lib/gemma-auth";

export const runtime = "nodejs";

function unauthorized() {
  return Response.json({ error: "Accedi all’Area Cliente per gestire le notifiche." }, { status: 401 });
}

export async function GET(request) {
  const user = await activeAuthSession(request);
  if (!user || user.role !== "CUSTOMER") return unauthorized();

  return Response.json(webPushPublicConfig(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request) {
  try {
    const user = await activeAuthSession(request);
    if (!user || user.role !== "CUSTOMER") return unauthorized();

    const body = await request.json();
    const subscription = await savePushSubscription({
      customerKey: userCustomerKey(user),
      subscription: body?.subscription,
      userAgent: request.headers.get("user-agent") || "",
    });

    return Response.json({ enabled: Boolean(subscription) }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Notifiche push non configurate.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  try {
    const user = await activeAuthSession(request);
    if (!user || user.role !== "CUSTOMER") return unauthorized();

    const body = await request.json();
    await removePushSubscription({
      customerKey: userCustomerKey(user),
      endpoint: body?.endpoint,
    });

    return Response.json({ enabled: false });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Notifiche push non aggiornate.",
      },
      { status: 400 },
    );
  }
}
