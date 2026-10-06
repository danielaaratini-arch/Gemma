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

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Gemma architecture guard: OK");
