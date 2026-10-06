import webPush from "web-push";
import { randomUUID } from "node:crypto";
import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";

function config() {
  const publicKey = String(process.env.GEMMA_WEB_PUSH_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.GEMMA_WEB_PUSH_PRIVATE_KEY || "").trim();
  const subject = String(
    process.env.GEMMA_WEB_PUSH_SUBJECT || "https://taap-gemma.vercel.app",
  ).trim();

  return {
    publicKey,
    privateKey,
    subject,
    configured: Boolean(publicKey && privateKey && subject),
  };
}

export function webPushPublicConfig() {
  const current = config();
  return {
    configured: current.configured,
    publicKey: current.configured ? current.publicKey : null,
  };
}

function normalizedSubscription(value) {
  const endpoint = String(value?.endpoint || "").trim();
  const p256dh = String(value?.keys?.p256dh || "").trim();
  const auth = String(value?.keys?.auth || "").trim();

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new Error("Sottoscrizione push non valida.");
  }

  return { endpoint, keys: { p256dh, auth } };
}

export async function savePushSubscription({
  customerKey,
  subscription,
  userAgent = "",
}) {
  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) throw new Error("Database non disponibile.");

  const normalized = normalizedSubscription(subscription);

  const rows = await sql.unsafe(
    "INSERT INTO gemma.push_subscription " +
      "(id,customer_key,endpoint,p256dh,auth,user_agent,active,failure_count,created_at,updated_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,true,0,now(),now()) " +
      "ON CONFLICT (endpoint) DO UPDATE SET " +
      "customer_key=EXCLUDED.customer_key,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth," +
      "user_agent=EXCLUDED.user_agent,active=true,failure_count=0,updated_at=now() " +
      "RETURNING id,customer_key,endpoint,active,created_at,updated_at",
    [
      randomUUID(),
      String(customerKey),
      normalized.endpoint,
      normalized.keys.p256dh,
      normalized.keys.auth,
      String(userAgent || "").slice(0, 500) || null,
    ],
  );

  return rows[0] || null;
}

export async function removePushSubscription({ customerKey, endpoint }) {
  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) return false;

  const rows = await sql.unsafe(
    "UPDATE gemma.push_subscription SET active=false,updated_at=now() " +
      "WHERE customer_key=$1 AND endpoint=$2 RETURNING id",
    [String(customerKey), String(endpoint || "")],
  );

  return Boolean(rows[0]);
}

async function markPushResult(id, { success, permanentFailure = false }) {
  const sql = operationalDb();
  if (!sql) return;

  if (success) {
    await sql.unsafe(
      "UPDATE gemma.push_subscription SET active=true,failure_count=0,last_success_at=now(),updated_at=now() WHERE id=$1",
      [id],
    );
    return;
  }

  await sql.unsafe(
    "UPDATE gemma.push_subscription SET " +
      "failure_count=failure_count+1,active=CASE WHEN $2 THEN false ELSE active END,updated_at=now() " +
      "WHERE id=$1",
    [id, permanentFailure],
  );
}

export async function sendPushToCustomer(customerKey, payload) {
  const current = config();
  if (!current.configured || !customerKey) {
    return { attempted: 0, delivered: 0, configured: current.configured };
  }

  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) return { attempted: 0, delivered: 0, configured: true };

  const subscriptions = await sql.unsafe(
    "SELECT id,endpoint,p256dh,auth FROM gemma.push_subscription " +
      "WHERE customer_key=$1 AND active=true ORDER BY updated_at DESC LIMIT 20",
    [String(customerKey)],
  );

  if (!subscriptions.length) {
    return { attempted: 0, delivered: 0, configured: true };
  }

  webPush.setVapidDetails(
    current.subject,
    current.publicKey,
    current.privateKey,
  );

  const body = JSON.stringify({
    title: String(payload?.title || "Gemma").slice(0, 120),
    body: String(payload?.body || "").slice(0, 500),
    url: String(payload?.url || "/cliente").slice(0, 500),
    tag: String(payload?.tag || "gemma-ticket").slice(0, 120),
  });

  let delivered = 0;

  await Promise.all(
    subscriptions.map(async (item) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: item.endpoint,
            keys: {
              p256dh: item.p256dh,
              auth: item.auth,
            },
          },
          body,
          {
            TTL: 60 * 60 * 24,
            urgency: "normal",
          },
        );
        delivered += 1;
        await markPushResult(item.id, { success: true });
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        const permanentFailure = statusCode === 404 || statusCode === 410;
        await markPushResult(item.id, {
          success: false,
          permanentFailure,
        });
        if (!permanentFailure) {
          console.error("Gemma push delivery error", {
            statusCode,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }),
  );

  return {
    attempted: subscriptions.length,
    delivered,
    configured: true,
  };
}

const STATUS_LABELS = {
  OPEN: "Aperto",
  IN_PROGRESS: "In lavorazione",
  WAITING_CUSTOMER: "In attesa di una tua risposta",
  WAITING_DEPARTMENT: "In attesa del reparto competente",
  RESOLVED: "Risolto",
  CLOSED: "Chiuso",
};

export async function notifyCustomerTicketStatus(ticket, previousStatus) {
  if (!ticket?.customer_key || !ticket?.id) {
    return { attempted: 0, delivered: 0, configured: config().configured };
  }

  const nextLabel = STATUS_LABELS[ticket.status] || String(ticket.status || "aggiornato");
  const number = String(ticket.number || "").padStart(6, "0");

  return await sendPushToCustomer(ticket.customer_key, {
    title: "Aggiornamento ticket #" + number,
    body: "Lo stato della tua segnalazione è ora: " + nextLabel + ".",
    url: "/cliente?ticket=" + encodeURIComponent(ticket.id),
    tag: "gemma-ticket-" + ticket.id,
    previousStatus,
  });
}
