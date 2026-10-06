import nodemailer from "nodemailer";
import { operationalDb } from "./db";

function enabled() {
  return String(process.env.NOTIFICATIONS_EMAIL_ENABLED || "").toLowerCase() === "true";
}

function config() {
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASSWORD || "");
  const from = String(process.env.SMTP_FROM || user).trim();
  if (!user || !pass || !from) throw new Error("Configurazione SMTP incompleta.");
  const port = Number.parseInt(process.env.SMTP_PORT || "465", 10) || 465;
  return {
    host: String(process.env.SMTP_HOST || "smtp.tiscali.it").trim(),
    port,
    secure: process.env.SMTP_SECURE == null
      ? port === 465
      : String(process.env.SMTP_SECURE).toLowerCase() === "true",
    user,
    pass,
    from,
    fromName: String(process.env.SMTP_FROM_NAME || "Tiscali Assistenza").trim(),
  };
}

function displayNumber(value) {
  return "#" + String(value || "").padStart(6, "0");
}

async function writeLog(ticketId, event, recipient, status, detail = null) {
  const sql = operationalDb();
  if (!sql) return;
  try {
    await sql.unsafe(
      "INSERT INTO gemma.ticket_notification (id,ticket_id,event,recipient,status,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,now())",
      [crypto.randomUUID(), ticketId, event, recipient, status, detail],
    );
  } catch (error) {
    console.error("Gemma notification log error", error);
  }
}

async function send(ticket, event, subject, body) {
  const recipient = String(ticket?.notification_email || "").trim().toLowerCase();
  if (!recipient) return { sent: false, reason: "no-recipient" };
  if (!enabled()) {
    await writeLog(ticket.id, event, recipient, "SKIPPED", "NOTIFICATIONS_EMAIL_ENABLED non attivo");
    return { sent: false, reason: "disabled" };
  }

  try {
    const smtp = config();
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { ciphers: "DEFAULT@SECLEVEL=1", servername: smtp.host },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const info = await transporter.sendMail({
      from: { name: smtp.fromName, address: smtp.from },
      to: recipient,
      subject,
      text: body,
    });
    await writeLog(ticket.id, event, recipient, "SENT", info.messageId || null);
    return { sent: true, reason: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore SMTP";
    await writeLog(ticket.id, event, recipient, "FAILED", message.slice(0, 1000));
    console.error("Gemma notification send error", message);
    return { sent: false, reason: "failed" };
  }
}

export async function notifyTicketCreated(ticket) {
  const number = displayNumber(ticket.number);
  return send(
    ticket,
    "CREATED",
    "Abbiamo ricevuto la tua richiesta – Ticket " + number,
    [
      "Gentile Cliente,",
      "",
      "abbiamo ricevuto la tua richiesta e aperto il ticket " + number + ".",
      "",
      "La segnalazione è stata registrata e verrà presa in carico dal nostro team.",
      "",
      "Grazie,",
      "Assistenza Clienti Tiscali",
    ].join("\n"),
  );
}

export async function notifyTicketStatusChanged(ticket, previousStatus) {
  if (!ticket || previousStatus === ticket.status) return { sent: false, reason: "unchanged" };
  const number = displayNumber(ticket.number);
  if (ticket.status === "IN_PROGRESS") {
    return send(ticket, "STATUS_CHANGED", "Stiamo lavorando sulla tua richiesta – Ticket " + number,
      "Gentile Cliente,\n\nil ticket " + number + " è ora in lavorazione.\n\nAssistenza Clienti Tiscali");
  }
  if (ticket.status === "RESOLVED") {
    return send(ticket, "STATUS_CHANGED", "La tua richiesta è stata risolta – Ticket " + number,
      "Gentile Cliente,\n\nabbiamo completato le attività relative al ticket " + number + ".\n\nAssistenza Clienti Tiscali");
  }
  if (ticket.status === "CLOSED") {
    return send(ticket, "CLOSED", "Ticket " + number + " chiuso",
      "Gentile Cliente,\n\nil ticket " + number + " è stato chiuso.\n\nAssistenza Clienti Tiscali");
  }
  return { sent: false, reason: "status-not-notified" };
}
