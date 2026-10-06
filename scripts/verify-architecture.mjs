import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const knowledge = read("lib/knowledge.js");
const store = read("lib/gemma-store.js");
const chat = read("app/api/chat/route.js");
const page = read("app/page.js");
const failures = [];

if (!knowledge.includes('sql.begin("read only"')) {
  failures.push("Il retrieval Knowledge non forza una transazione read-only.");
}

for (const verb of ["INSERT INTO", "UPDATE ", "DELETE FROM", "CREATE TABLE", "ALTER TABLE", "DROP TABLE"]) {
  if (knowledge.toUpperCase().includes(verb)) {
    failures.push("Scrittura rilevata nel modulo Knowledge: " + verb.trim());
  }
}

if (!store.includes("CREATE SCHEMA IF NOT EXISTS gemma")) {
  failures.push("Manca lo schema operativo isolato gemma.");
}

for (const forbidden of [
  'INSERT INTO "Knowledge',
  'UPDATE "Knowledge',
  'DELETE FROM "Knowledge',
  'INSERT INTO "Conversation',
  'UPDATE "Conversation',
  'INSERT INTO "Ticket',
  'UPDATE "Ticket',
]) {
  if (store.includes(forbidden)) {
    failures.push("Scrittura su tabella Lia/Alda rilevata: " + forbidden);
  }
}

if (!chat.includes("Nel troubleshooting proponi un solo passo alla volta")) {
  failures.push("Manca il guardrail one-step-at-a-time.");
}

if (!chat.includes("rispondi prima al chiarimento")) {
  failures.push("Manca il guardrail chiarimento-prima-ripresa.");
}

if (!chat.includes("<<GEMMA_STATE>>")) {
  failures.push("Manca lo stato strutturato del riepilogo dinamico.");
}

if (!chat.includes("saveConversationTurn")) {
  failures.push("Lo stato conversazionale non viene persistito.");
}

if (!fs.existsSync("app/api/tts/route.js")) {
  failures.push("Endpoint TTS Gemma mancante.");
}

if (!page.includes('useGemmaSpeech')) {
  failures.push("Client Gemma non usa il TTS dedicato.");
}

for (const route of ["app/cliente/page.js", "app/backoffice/page.js", "app/admin/page.js"]) {
  if (!fs.existsSync(route)) failures.push("Area mancante: " + route);
}

const dbModule = read("lib/db.js");
const storeModule = read("lib/gemma-store.js");
const ticketRoute = read("app/api/gemma/tickets/route.js");

if (!dbModule.includes("GEMMA_DB_READ_POOL") || !dbModule.includes("GEMMA_DB_WRITE_POOL")) {
  failures.push("Manca la separazione dei pool DB Gemma.");
}

if (!storeModule.includes("request_key") || !storeModule.includes("ON CONFLICT DO NOTHING")) {
  failures.push("Manca l'idempotenza atomica dei ticket.");
}

if (!storeModule.includes("consumeAiRateLimit")) {
  failures.push("Manca il rate limiting AI.");
}

if (!ticketRoute.includes("nextCursor")) {
  failures.push("Manca la paginazione cursor-based dei ticket.");
}

if (!fs.existsSync("app/api/gemma/tickets/[id]/attachments/route.js")) {
  failures.push("Endpoint allegati ticket mancante.");
}

if (!fs.existsSync("app/api/gemma/files/[id]/route.js")) {
  failures.push("Endpoint lettura allegati mancante.");
}

if (!read("lib/gemma-store.js").includes("ticket_attachment")) {
  failures.push("Persistenza allegati Gemma mancante.");
}

if (!read("lib/gemma-store.js").includes("notification_email")) {
  failures.push("Email notifiche ticket mancante.");
}

if (!read("lib/gemma-notifications.js").includes("SMTP_USER")) {
  failures.push("Configurazione notifiche SMTP mancante.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Gemma architecture guard: OK");
