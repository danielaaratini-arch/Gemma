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

const internalRequired = [
  "components/GemmaInternalAuth.js",
  "components/GemmaInternalNav.js",
  "app/admin/users/page.js",
  "app/admin/faults/page.js",
  "app/admin/memory/page.js",
  "app/admin/ai-router/page.js",
  "app/admin/gradimento/page.js",
  "app/admin/knowledge/page.js",
  "app/backoffice/performance/page.js",
  "app/conversations/page.js",
  "app/reports/page.js",
  "app/api/gemma/auth/login/route.js",
  "app/api/gemma/auth/session/route.js",
  "app/api/gemma/tickets/[id]/view/route.js",
];

for (const path of internalRequired) {
  if (!fs.existsSync(path)) failures.push("Funzione interna Gemma mancante: " + path);
}

const chatRoute = read("app/api/chat/route.js");
if (!chatRoute.includes("retrieveGemmaOperationalContext")) {
  failures.push("Alert e Customer Memory non sono integrati nel contesto Gemma.");
}

const knowledgeSyncRequired = [
  "lib/gemma-knowledge-sync.js",
  "lib/gemma-no-match.js",
  "app/api/gemma/admin/knowledge-sync/route.js",
  "app/api/gemma/admin/no-match/route.js",
  "app/admin/no-match/page.js",
];

for (const path of knowledgeSyncRequired) {
  if (!fs.existsSync(path)) {
    failures.push("Funzione Knowledge Gemma mancante: " + path);
  }
}

if (fs.existsSync("lib/gemma-knowledge-sync.js")) {
  const sync = read("lib/gemma-knowledge-sync.js");
  for (const token of [
    "startKnowledgePreview",
    "stepKnowledgePreview",
    "startKnowledgeApply",
    "stepKnowledgeApply",
    "stepKnowledgeRollback",
    "knowledge_snapshot",
  ]) {
    if (!sync.includes(token)) {
      failures.push("Knowledge sync incompleto: " + token);
    }
  }
}

if (fs.existsSync("lib/gemma-no-match.js")) {
  const noMatch = read("lib/gemma-no-match.js");
  if (!noMatch.includes("knowledgeHits")) {
    failures.push("No Match Gemma non è definito da knowledgeHits = 0.");
  }
}

if (!read("app/page.js").includes("SpeechRecognition")) {
  failures.push("Microfono / dettatura Gemma mancante.");
}

if (!read("app/page.js").includes("Parla con Gemma")) {
  failures.push("Controllo microfono Gemma mancante nel composer.");
}

if (!read("app/cliente/page.js").includes("Detta il messaggio")) {
  failures.push("Microfono area cliente Gemma mancante.");
}

if (!knowledge.includes("retrieveKnowledgeDetailed")) {
  failures.push("Retrieval Knowledge Gemma non espone il risultato dettagliato.");
}

if (!knowledge.includes("service-scoped") || !knowledge.includes("scoped-empty")) {
  failures.push("Retrieval Fisso/Mobile senza scope di servizio.");
}

if (!chat.includes("knowledgeServiceHint(previousState)")) {
  failures.push("Lo stato conversazionale non guida il retrieval Fisso/Mobile.");
}

if (!chat.includes("Punto in sospeso:") || !chat.includes("state?.checks")) {
  failures.push("Il retrieval non usa il contesto diagnostico persistito.");
}

if (!chat.includes("MOBILE_TECHNICAL") || !chat.includes("FIXED_TECHNICAL")) {
  failures.push("Routing semantico Fisso/Mobile verso backoffice mancante.");
}

if (!store.includes("Gemma non ha ancora determinato il reparto corretto")) {
  failures.push("I ticket senza reparto possono ancora entrare nel backoffice.");
}

if (!chat.includes("azzera fatti, verifiche, pending, outcome, resolved e ticketRecommended")) {
  failures.push("Cambio argomento Gemma senza reset esplicito del caso precedente.");
}

if (!knowledge.includes("inferCurrentTurnService") || !knowledge.includes("topic-switch-scoped")) {
  failures.push("Il retrieval non protegge il cambio argomento dal vecchio scope Fisso/Mobile.");
}

if (!chat.includes("CHIARIMENTO:") || !chat.includes("INFORMAZIONE COLLEGATA:") || !chat.includes("CAMBIO ARGOMENTO:")) {
  failures.push("Gemma non distingue chiarimenti, informazioni collegate e cambio argomento.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Gemma architecture guard: OK");
