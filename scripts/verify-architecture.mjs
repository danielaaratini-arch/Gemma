import fs from "node:fs";
import path from "node:path";

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
const ticketDetailRoute = read("app/api/gemma/tickets/[id]/route.js");
const ticketMessageRoute = read("app/api/gemma/tickets/[id]/messages/route.js");

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

if (!chat.includes('reasoning: { effort: "none" }')) {
  failures.push("Gemma realtime non usa reasoning none.");
}

if (!chat.includes("routeSalesTurn(lastUser") || chat.indexOf("routeSalesTurn(lastUser") > chat.indexOf("consumeAiRateLimit(customer.key")) {
  failures.push("Vendita Gemma non intercettata nel percorso zero-AI prima del rate/AI.");
}

if (!fs.existsSync("lib/gemma-sales.js")) {
  failures.push("Router vendita zero-AI Gemma mancante.");
}

if (!read("components/GemmaAvatar.js").includes("getGemmaAudioLevel")) {
  failures.push("Labbra Gemma non pilotate dal livello audio reale.");
}

if (!read("components/useGemmaSpeech.js").includes("createAnalyser")) {
  failures.push("Analisi audio TTS Gemma mancante.");
}

if (!read("app/page.js").includes("visibleSegment") || !read("app/page.js").includes("onProgress")) {
  failures.push("Testo Gemma non sincronizzato al clock audio.");
}

if (!fs.existsSync("app/api/gemma/guides/route.js") || !fs.existsSync("public/knowledge/mobile-config/manifest.json")) {
  failures.push("Guide illustrate Gemma incomplete.");
}

if (!fs.existsSync("app/api/gemma/videos/route.js") || !fs.existsSync("lib/gemma-video.js")) {
  failures.push("Videoguide Gemma mancanti.");
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


if (!fs.existsSync("components/GemmaCustomerAuth.js")) {
  failures.push("Autenticazione Area Cliente Gemma mancante.");
}

if (!read("app/cliente/page.js").includes("GemmaCustomerAuth")) {
  failures.push("Area Cliente non protetta da autenticazione Gemma.");
}

if (!read("lib/gemma-auth.js").includes("activeAuthSession")) {
  failures.push("Sessioni Admin/Backoffice non revocabili dal DB.");
}

if (read("app/api/gemma/admin/faults/route.js").includes("if (!auth(request))")) {
  failures.push("Autorizzazione Admin asincrona non attesa correttamente.");
}

if (!read("lib/gemma-no-match.js").includes("knowledgeMode")) {
  failures.push("I guasti retrieval possono contaminare la vista No Match.");
}

if (!fs.existsSync("app/api/gemma/admin/knowledge/[id]/route.js")) {
  failures.push("Editor manuale Knowledge Gemma mancante.");
}

if (!read("app/admin/knowledge/page.js").includes("saveManualDocument")) {
  failures.push("UI integrazione manuale Knowledge mancante.");
}

if (fs.existsSync("lib/gemma-knowledge-sync.js")) {
  const hardenedSync = read("lib/gemma-knowledge-sync.js");
  for (const token of [
    "proposalSafety",
    "apply_claimed_at",
    "PREVIEW_READY",
    "DRAFT",
  ]) {
    if (!hardenedSync.includes(token)) {
      failures.push("Protezione Knowledge massiva mancante: " + token);
    }
  }
}

if (!store.includes("GEMMA_ALLOW_DB_ATTACHMENTS")) {
  failures.push("Manca il blocco storage allegati DB in production.");
}

if (!fs.existsSync("scripts/migrate-gemma.mjs")) {
  failures.push("Migrazione controllata schema Gemma mancante.");
}

if (!store.includes("productionNoAutoMigrate")) {
  failures.push("Lo schema Gemma esegue ancora DDL automatico in production.");
}

if (!read("lib/gemma-admin.js").includes("ANY($1::text[])")) {
  failures.push("Cronologia conversazioni usa ancora query N+1.");
}

if (!ticketRoute.includes('from "next/server"') || !ticketRoute.includes("after(")) {
  failures.push("Notifiche ticket ancora bloccanti sulla risposta HTTP.");
}

if (!store.includes("push_subscription")) {
  failures.push("Persistenza sottoscrizioni Web Push Gemma mancante.");
}

if (!fs.existsSync("lib/gemma-push.js")) {
  failures.push("Servizio Web Push Gemma mancante.");
}

if (!fs.existsSync("app/api/gemma/push/route.js")) {
  failures.push("API sottoscrizioni Web Push Gemma mancante.");
}

if (!fs.existsSync("public/gemma-push-sw.js")) {
  failures.push("Service worker Web Push Gemma mancante.");
}

if (!read("app/cliente/page.js").includes("Attiva notifiche")) {
  failures.push("Opt-in Web Push Area Cliente mancante.");
}

if (!ticketDetailRoute.includes("notifyCustomerTicketStatus")) {
  failures.push("I cambi stato ticket non inviano la push al cliente.");
}

if (!ticketMessageRoute.includes("notifyCustomerTicketStatus")) {
  failures.push("I cambi stato tramite risposta Backoffice non inviano la push al cliente.");
}

if (!read("package.json").includes('"web-push"')) {
  failures.push("Dipendenza Web Push standard mancante.");
}

if (!fs.existsSync("lib/gemma-knowledge-ingest.js")) {
  failures.push("Modulo ingest Knowledge allineato a Lia/Alda mancante.");
} else {
  const ingest = read("lib/gemma-knowledge-ingest.js");
  for (const token of [
    "lia-final-hygiene-v2.4",
    "KNOWLEDGE_FINAL_HYGIENE_EXCLUDED_FILES",
    "applyPersistentKnowledgeHygiene",
    "importedPageClassification",
    "prepareImportedKnowledgePage",
  ]) {
    if (!ingest.includes(token)) {
      failures.push("Parità ingest Lia/Alda incompleta: " + token);
    }
  }
}

if (!read("lib/gemma-knowledge-sync.js").includes("ingest_revision")) {
  failures.push("I job Knowledge non sono vincolati alla revisione ingest.");
}

if (
  !read("lib/gemma-knowledge-sync.js").includes(
    "La Preview è stata generata con una revisione ingest precedente",
  )
) {
  failures.push("Apply Knowledge senza blocco delle Preview ingest obsolete.");
}

if (!fs.existsSync("lib/gemma-knowledge-worker.js") ||
    !fs.existsSync("app/api/gemma/internal/knowledge-worker/route.js")) {
  failures.push("Worker autonomo Knowledge mancante.");
}

if (!read("app/api/gemma/admin/knowledge-sync/route.js").includes("continueInBackground")) {
  failures.push("I job Knowledge dipendono ancora dal browser per proseguire.");
}

if (!read("scripts/migrate-gemma.mjs").includes("migrateKnowledgeSyncSchema")) {
  failures.push("La migrazione production non include lo schema Knowledge Sync.");
}

if (!read("lib/gemma-knowledge-sync.js").includes("productionNoAutoMigrate")) {
  failures.push("Knowledge Sync può ancora eseguire DDL automatico in production.");
}

if (!fs.existsSync("app/api/gemma/admin/knowledge/upload/route.js") ||
    !fs.existsSync("lib/gemma-document-parser.js")) {
  failures.push("Upload documenti Knowledge Gemma mancante.");
}

if (!read("app/admin/knowledge/page.js").includes("loadKnowledgeFile")) {
  failures.push("Upload Knowledge non collegato all'interfaccia Admin.");
}

if (!read("package.json").includes('"pdf-parse"') ||
    !read("package.json").includes('"mammoth"')) {
  failures.push("Parser PDF/DOCX Knowledge mancanti.");
}

if (!store.includes("blob_path TEXT") ||
    !store.includes("blob ? null : Buffer.from(file.buffer)")) {
  failures.push("Gli allegati possono ancora essere salvati come binario DB quando Blob è disponibile.");
}

if (!store.includes("customer_code TEXT") ||
    !store.includes("service_number TEXT") ||
    !store.includes("notification_email_verified")) {
  failures.push("Dati cliente strutturati incompleti nel ticket.");
}

if (!read("lib/gemma-auth.js").includes("email_verified") ||
    !fs.existsSync("app/api/gemma/auth/verify-email/route.js")) {
  failures.push("Verifica email cliente incompleta.");
}

if (!read("app/backoffice/page.js").includes("Codice cliente") ||
    !read("app/backoffice/page.js").includes("Numero linea / SIM")) {
  failures.push("Backoffice non mostra i dati cliente strutturati.");
}

if (!dbModule.includes("databaseConnectionProfile") ||
    !dbModule.includes("productionConservativeMode")) {
  failures.push("Protezione pool DB serverless production mancante.");
}

if (read("components/GemmaInternalNav.js").includes("AI Router")) {
  failures.push("AI Router tecnico ancora esposto nel menu Admin.");
}

if (read("components/GemmaInternalNav.js").includes('"/admin/memory"')) {
  failures.push("Customer Memory tecnica ancora esposta nel menu Admin.");
}

if (!store.includes("customerContextFromRequest") ||
    !chat.includes("await customerContextFromRequest(request)")) {
  failures.push("Le API cliente non validano l'account attivo sul database.");
}

if (!read("lib/gemma-knowledge-sync.js").includes("fetchImportedKnowledgePage") ||
    read("lib/gemma-knowledge-sync.js").includes("async function fetchPage(urlValue)")) {
  failures.push("Knowledge Sync non usa esclusivamente il fetch maturo Lia/Alda.");
}

if (!read("lib/gemma-auth.js").includes("customerCode: user.customer_code") ||
    !read("lib/gemma-auth.js").includes("serviceNumber: user.service_number")) {
  failures.push("La registrazione cliente non normalizza i dati strutturati.");
}

const sourceRoots = ["app", "components", "lib", "scripts"];
const sourceFiles = [];

function collectSourceFiles(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(target);
    } else if (/\.(?:js|mjs)$/.test(entry.name)) {
      sourceFiles.push(target);
    }
  }
}

for (const root of sourceRoots) collectSourceFiles(root);

for (const sourceFile of sourceFiles) {
  const source = read(sourceFile);
  const relativeImports = [
    ...source.matchAll(/(?:from\s+|import\()["']([^"']+)["']/g),
  ]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));

  for (const specifier of relativeImports) {
    const target = path.resolve(path.dirname(sourceFile), specifier);
    const relativeToProject = path.relative(process.cwd(), target);

    if (
      relativeToProject.startsWith("..") ||
      path.isAbsolute(relativeToProject)
    ) {
      failures.push(
        "Import relativo fuori progetto: " + sourceFile + " -> " + specifier,
      );
      continue;
    }

    const candidates = [
      target,
      target + ".js",
      target + ".mjs",
      path.join(target, "index.js"),
      path.join(target, "index.mjs"),
    ];

    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      failures.push(
        "Import relativo non risolto: " + sourceFile + " -> " + specifier,
      );
    }
  }
}

const noMatchModule = read("lib/gemma-no-match.js");
if (
  !noMatchModule.includes("m.metadata_json ? 'knowledgeHits'") ||
  !noMatchModule.includes("knowledgeMode")
) {
  failures.push(
    "No Match può ancora includere messaggi legacy o errori retrieval.",
  );
}

if (
  !store.includes("ticket_service_number") ||
  !store.includes("ticket_email_verified") ||
  !store.includes("user_service_number")
) {
  failures.push("Il controllo schema production non verifica tutti i dati cliente.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Gemma architecture guard: OK");
