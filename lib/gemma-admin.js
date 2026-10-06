import { randomUUID } from "node:crypto";
import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";
import { hashPassword } from "./gemma-auth";

function db() {
  const sql = operationalDb();
  if (!sql) throw new Error("Database non disponibile.");
  return sql;
}

export async function listInternalUsers() {
  await ensureGemmaSchema();
  return await db().unsafe(
    "SELECT id,email,name,role,active,created_at,updated_at,last_login_at FROM gemma.user_account WHERE role IN ('ADMIN','OPERATOR') ORDER BY role,name",
  );
}

export async function createInternalUser({ name, email, password, role }) {
  await ensureGemmaSchema();
  const normalizedRole = role === "ADMIN" ? "ADMIN" : "OPERATOR";
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim().slice(0, 120);
  if (!normalizedName) throw new Error("Nome obbligatorio.");
  if (!normalizedEmail.includes("@")) throw new Error("Email non valida.");

  try {
    const rows = await db().unsafe(
      "INSERT INTO gemma.user_account (id,email,name,password_hash,role,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,true,now(),now()) RETURNING id,email,name,role,active,created_at,updated_at,last_login_at",
      [randomUUID(), normalizedEmail, normalizedName, hashPassword(password), normalizedRole],
    );
    return rows[0];
  } catch (error) {
    if (String(error?.code) === "23505") {
      throw new Error("Esiste già un account con questa email.");
    }
    throw error;
  }
}

export async function updateInternalUser(id, patch) {
  await ensureGemmaSchema();
  const sql = db();
  const current = await sql.unsafe(
    "SELECT id,email,name,role,active,password_hash FROM gemma.user_account WHERE id=$1 AND role IN ('ADMIN','OPERATOR') LIMIT 1",
    [id],
  );
  if (!current[0]) return null;

  const nextName =
    typeof patch.name === "string" && patch.name.trim()
      ? patch.name.trim().slice(0, 120)
      : current[0].name;
  const nextEmail =
    typeof patch.email === "string" && patch.email.trim()
      ? patch.email.trim().toLowerCase()
      : current[0].email;
  const nextRole =
    patch.role === "ADMIN" || patch.role === "OPERATOR"
      ? patch.role
      : current[0].role;
  const nextActive =
    typeof patch.active === "boolean" ? patch.active : current[0].active;
  const nextHash =
    typeof patch.password === "string" && patch.password
      ? hashPassword(patch.password)
      : current[0].password_hash;

  try {
    const rows = await sql.unsafe(
      "UPDATE gemma.user_account SET name=$2,email=$3,role=$4,active=$5,password_hash=$6,updated_at=now() WHERE id=$1 RETURNING id,email,name,role,active,created_at,updated_at,last_login_at",
      [id, nextName, nextEmail, nextRole, nextActive, nextHash],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (String(error?.code) === "23505") {
      throw new Error("Esiste già un account con questa email.");
    }
    throw error;
  }
}

export async function deleteInternalUser(id) {
  await ensureGemmaSchema();
  const rows = await db().unsafe(
    "DELETE FROM gemma.user_account WHERE id=$1 AND role IN ('ADMIN','OPERATOR') RETURNING id",
    [id],
  );
  return Boolean(rows[0]);
}

export async function listFaults() {
  await ensureGemmaSchema();
  return await db().unsafe(
    "SELECT id,service,fault_type,city,match_description,message,active,created_at,updated_at FROM gemma.service_fault ORDER BY active DESC, updated_at DESC",
  );
}

export async function saveFault(input) {
  await ensureGemmaSchema();
  const id = String(input.id || "").trim() || randomUUID();
  const service = String(input.service || "").trim().toUpperCase();
  const faultType = String(input.faultType || "").trim().toUpperCase();
  const city = String(input.city || "").trim() || null;
  const matchDescription = String(input.matchDescription || "").trim().slice(0, 1000);
  const message = String(input.message || "").trim().slice(0, 2000);
  const active = input.active !== false;

  if (!["MOBILE","EMAIL","FIXED"].includes(service)) {
    throw new Error("Servizio non valido.");
  }
  if (!faultType || !matchDescription || !message) {
    throw new Error("Tipologia, descrizione semantica e messaggio sono obbligatori.");
  }

  const rows = await db().unsafe(
    "INSERT INTO gemma.service_fault (id,service,fault_type,city,match_description,message,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now()) ON CONFLICT (id) DO UPDATE SET service=EXCLUDED.service,fault_type=EXCLUDED.fault_type,city=EXCLUDED.city,match_description=EXCLUDED.match_description,message=EXCLUDED.message,active=EXCLUDED.active,updated_at=now() RETURNING *",
    [id, service, faultType, city, matchDescription, message, active],
  );
  return rows[0];
}

export async function deleteFault(id) {
  await ensureGemmaSchema();
  const rows = await db().unsafe(
    "DELETE FROM gemma.service_fault WHERE id=$1 RETURNING id",
    [id],
  );
  return Boolean(rows[0]);
}

export async function listMemory(customerKey) {
  await ensureGemmaSchema();
  return await db().unsafe(
    "SELECT id,customer_key,value,source,created_at,updated_at FROM gemma.customer_memory WHERE customer_key=$1 ORDER BY updated_at DESC",
    [String(customerKey || "").trim()],
  );
}

export async function createMemory({ customerKey, value, source }) {
  await ensureGemmaSchema();
  const key = String(customerKey || "").trim();
  const text = String(value || "").trim().slice(0, 2000);
  if (!key || !text) throw new Error("Cliente e memoria sono obbligatori.");

  const rows = await db().unsafe(
    "INSERT INTO gemma.customer_memory (id,customer_key,value,source,created_at,updated_at) VALUES ($1,$2,$3,$4,now(),now()) RETURNING *",
    [randomUUID(), key, text, String(source || "ADMIN").slice(0, 80)],
  );
  return rows[0];
}

export async function updateMemory(id, value) {
  await ensureGemmaSchema();
  const text = String(value || "").trim().slice(0, 2000);
  if (!text) throw new Error("Memoria vuota.");
  const rows = await db().unsafe(
    "UPDATE gemma.customer_memory SET value=$2,updated_at=now() WHERE id=$1 RETURNING *",
    [id, text],
  );
  return rows[0] ?? null;
}

export async function deleteMemory(id) {
  await ensureGemmaSchema();
  const rows = await db().unsafe(
    "DELETE FROM gemma.customer_memory WHERE id=$1 RETURNING id",
    [id],
  );
  return Boolean(rows[0]);
}

export async function adminDashboard() {
  await ensureGemmaSchema();
  const sql = db();

  const [tickets, conversations, knowledge, messages, users] = await Promise.all([
    sql.unsafe(
      "SELECT status,coalesce(department,'OTHER') AS department,count(*)::int AS count FROM gemma.ticket GROUP BY status,coalesce(department,'OTHER')",
    ),
    sql.unsafe(
      "SELECT count(*)::int AS total,count(*) FILTER (WHERE status='ACTIVE')::int AS active FROM gemma.conversation",
    ),
    sql.unsafe(
      'SELECT count(*) FILTER (WHERE "status"=\'ACTIVE\')::int AS active_documents,(SELECT count(*)::int FROM "KnowledgeChunk") AS chunks FROM "KnowledgeDocument"',
    ),
    sql.unsafe(
      "SELECT count(*)::int AS total_turns,count(*) FILTER (WHERE role='GEMMA' AND coalesce((metadata_json->>'knowledgeHits')::int,0)=0)::int AS no_source_turns,round(avg((metadata_json->>'totalMs')::numeric))::int AS avg_total_ms,round(avg((metadata_json->>'retrievalMs')::numeric))::int AS avg_retrieval_ms FROM gemma.message WHERE role='GEMMA'",
    ),
    sql.unsafe(
      "SELECT role,count(*)::int AS count,count(*) FILTER (WHERE active=true)::int AS active FROM gemma.user_account WHERE role IN ('ADMIN','OPERATOR') GROUP BY role",
    ),
  ]);

  return {
    tickets,
    conversations: conversations[0] || {},
    knowledge: knowledge[0] || {},
    messages: messages[0] || {},
    users,
  };
}

export async function aiMetrics(limit = 50) {
  await ensureGemmaSchema();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const sql = db();

  const [summary, recent] = await Promise.all([
    sql.unsafe(
      "SELECT count(*)::int AS calls,round(avg((metadata_json->>'totalMs')::numeric))::int AS average_duration,round(avg((metadata_json->>'retrievalMs')::numeric))::int AS average_retrieval,count(*) FILTER (WHERE coalesce((metadata_json->>'knowledgeHits')::int,0)=0)::int AS no_source_calls FROM gemma.message WHERE role='GEMMA' AND metadata_json IS NOT NULL",
    ),
    sql.unsafe(
      "SELECT id,conversation_id,created_at,metadata_json FROM gemma.message WHERE role='GEMMA' AND metadata_json IS NOT NULL ORDER BY created_at DESC LIMIT $1",
      [safeLimit],
    ),
  ]);

  return {
    summary: summary[0] || {},
    recent: recent.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      model: row.metadata_json?.model || null,
      totalMs: Number(row.metadata_json?.totalMs || 0),
      retrievalMs: Number(row.metadata_json?.retrievalMs || 0),
      knowledgeHits: Number(row.metadata_json?.knowledgeHits || 0),
    })),
  };
}

export async function listConversations({ limit = 100, search = "" } = {}) {
  await ensureGemmaSchema();
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const q = "%" + String(search || "").trim().toLowerCase() + "%";
  const sql = db();

  const rows = await sql.unsafe(
    "SELECT id,customer_key,title,status,state_json,summary_text,created_at,updated_at FROM gemma.conversation WHERE $1='%%' OR lower(coalesce(title,'')) LIKE $1 OR lower(customer_key) LIKE $1 ORDER BY updated_at DESC LIMIT $2",
    [q, safeLimit],
  );

  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const messages = await sql.unsafe(
    "SELECT id,conversation_id,role,content,created_at FROM gemma.message WHERE conversation_id = ANY($1::text[]) ORDER BY conversation_id,created_at ASC",
    [ids],
  );

  const byConversation = new Map();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id) || [];
    list.push(message);
    byConversation.set(message.conversation_id, list);
  }

  return rows.map((row) => ({
    ...row,
    messages: byConversation.get(row.id) || [],
  }));
}

export async function performanceStats() {
  await ensureGemmaSchema();
  const sql = db();
  const ratings = await sql.unsafe(
    "SELECT score,operator_name,created_at FROM gemma.ticket_rating ORDER BY created_at DESC",
  );

  const general = {
    totalRatings: ratings.length,
    average:
      ratings.length > 0
        ? Math.round((ratings.reduce((sum, item) => sum + Number(item.score || 0), 0) / ratings.length) * 100) / 100
        : null,
    distribution: { "1":0,"2":0,"3":0,"4":0,"5":0 },
  };

  const operators = new Map();
  for (const rating of ratings) {
    general.distribution[String(rating.score)] += 1;
    const name = String(rating.operator_name || "Non assegnato");
    const bucket = operators.get(name) || {
      name,
      totalRatings: 0,
      sum: 0,
      distribution: { "1":0,"2":0,"3":0,"4":0,"5":0 },
    };
    bucket.totalRatings += 1;
    bucket.sum += Number(rating.score || 0);
    bucket.distribution[String(rating.score)] += 1;
    operators.set(name, bucket);
  }

  return {
    general,
    operators: Array.from(operators.values()).map((item) => ({
      name: item.name,
      totalRatings: item.totalRatings,
      average: item.totalRatings ? Math.round((item.sum / item.totalRatings) * 100) / 100 : null,
      distribution: item.distribution,
    })),
  };
}

export async function saveRating({ ticketId, score, comment }) {
  await ensureGemmaSchema();
  const normalizedScore = Number(score);
  if (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore > 5) {
    throw new Error("Valutazione non valida.");
  }

  const sql = db();
  const tickets = await sql.unsafe(
    "SELECT id,assignee,status FROM gemma.ticket WHERE id=$1 LIMIT 1",
    [ticketId],
  );
  if (!tickets[0]) throw new Error("Ticket non trovato.");
  if (!["RESOLVED","CLOSED"].includes(tickets[0].status)) {
    throw new Error("Puoi valutare solo un ticket risolto o chiuso.");
  }

  const rows = await sql.unsafe(
    "INSERT INTO gemma.ticket_rating (id,ticket_id,score,comment,operator_name,created_at) VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (ticket_id) DO UPDATE SET score=EXCLUDED.score,comment=EXCLUDED.comment,operator_name=EXCLUDED.operator_name RETURNING *",
    [randomUUID(), ticketId, normalizedScore, String(comment || "").trim().slice(0, 2000) || null, tickets[0].assignee || null],
  );
  return rows[0];
}


export async function listKnowledgeDocuments({ search = "", status = "ALL", limit = 200 } = {}) {
  await ensureGemmaSchema();
  const sql = db();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const q = "%" + String(search || "").trim().toLowerCase() + "%";
  const normalizedStatus = String(status || "ALL").toUpperCase();

  return await sql.unsafe(
    `SELECT
       d."id"::text AS id,
       d."title"::text AS title,
       d."description"::text AS description,
       d."category"::text AS category,
       d."status"::text AS status,
       d."serviceType"::text AS service_type,
       d."assistanceArea"::text AS assistance_area,
       d."topic"::text AS topic,
       d."sourceType"::text AS source_type,
       d."deviceScope"::text AS device_scope,
       d."updatedAt" AS updated_at,
       count(c."id")::int AS chunks
     FROM "KnowledgeDocument" d
     LEFT JOIN "KnowledgeChunk" c ON c."documentId" = d."id"
     WHERE ($1='%%' OR lower(coalesce(d."title",'')) LIKE $1 OR lower(coalesce(d."description",'')) LIKE $1 OR lower(coalesce(d."topic",'')) LIKE $1)
       AND ($2='ALL' OR d."status"::text = $2)
     GROUP BY d."id"
     ORDER BY d."updatedAt" DESC
     LIMIT $3`,
    [q, normalizedStatus, safeLimit],
  );
}


const KNOWLEDGE_CATEGORIES = new Set([
  "GENERAL",
  "FAQ",
  "PROCEDURE",
  "TECHNICAL_GUIDE",
  "CONTRACT",
  "TROUBLESHOOTING",
  "COMMERCIAL",
  "INTERNAL_POLICY",
]);

const KNOWLEDGE_STATUSES = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);

const KNOWLEDGE_SERVICES = new Set([
  "FIXED_NETWORK",
  "MOBILE",
  "EMAIL",
  "DOMAINS",
  "ADMINISTRATIVE",
  "OTHER",
]);

const KNOWLEDGE_AREAS = new Set([
  "COMMERCIAL",
  "TECHNICAL",
  "ADMINISTRATIVE",
  "ACTIVATION",
  "FAQ",
]);

function knowledgeChunks(value, maxLength = 1200) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) return [];

  const chunks = [];
  let rest = text;

  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength * 0.55)) cut = maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

function safeKnowledgeScalar(value, max = 1000) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}

export async function createManualKnowledgeDocument(input = {}) {
  await ensureGemmaSchema();
  const sql = db();

  const title = safeKnowledgeScalar(input.title, 500);
  const content = String(input.content || "").trim().slice(0, 200000);
  const category = KNOWLEDGE_CATEGORIES.has(input.category)
    ? input.category
    : "GENERAL";
  const status = KNOWLEDGE_STATUSES.has(input.status)
    ? input.status
    : "DRAFT";

  if (!title) throw new Error("Titolo Knowledge obbligatorio.");
  if (!content) throw new Error("Contenuto Knowledge obbligatorio.");

  const chunks = knowledgeChunks(content);
  if (!chunks.length) throw new Error("Contenuto Knowledge vuoto.");

  const id = randomUUID();
  const fileName =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) + ".txt";

  await sql.begin("read write", async (tx) => {
    await tx.unsafe(
      'INSERT INTO "KnowledgeDocument" (' +
        '"id","title","description","category","department","customerType",' +
        '"serviceType","assistanceArea","topic","status","version","tags",' +
        '"sourceType","usageHints","deviceScope","fileId","fileName",' +
        '"fileSize","fileType","fileUrl","createdAt","updatedAt"' +
      ') VALUES (' +
        '$1,$2,$3,$4::"KnowledgeCategory",NULL,NULL,$5,$6,$7,' +
        '$8::"KnowledgeDocumentStatus",\'1.0\',$9,\'GEMMA_MANUAL\',$10,$11,' +
        '$12,$13,$14,\'text/plain\',$15,now(),now()' +
      ')',
      [
        id,
        title,
        safeKnowledgeScalar(input.description, 2000),
        category,
        KNOWLEDGE_SERVICES.has(input.serviceType)
          ? input.serviceType
          : null,
        KNOWLEDGE_AREAS.has(input.assistanceArea)
          ? input.assistanceArea
          : null,
        safeKnowledgeScalar(input.topic, 120),
        status,
        safeKnowledgeScalar(input.tags, 1000),
        safeKnowledgeScalar(input.usageHints, 2000),
        safeKnowledgeScalar(input.deviceScope, 200),
        "gemma-manual-" + id,
        fileName || "gemma-manual.txt",
        Buffer.byteLength(content, "utf8"),
        "gemma://knowledge/" + id,
      ],
    );

    for (let index = 0; index < chunks.length; index += 1) {
      await tx.unsafe(
        'INSERT INTO "KnowledgeChunk" ("id","content","order","createdAt","documentId") VALUES ($1,$2,$3,now(),$4)',
        [randomUUID(), chunks[index], index, id],
      );
    }
  });

  return id;
}

export async function updateManualKnowledgeDocument(id, input = {}) {
  await ensureGemmaSchema();
  const sql = db();

  const rows = await sql.unsafe(
    'SELECT "id"::text AS id,"sourceType"::text AS source_type FROM "KnowledgeDocument" WHERE "id"=$1 LIMIT 1',
    [id],
  );
  if (!rows[0]) return null;

  const title =
    input.title !== undefined
      ? safeKnowledgeScalar(input.title, 500)
      : undefined;
  const status =
    input.status !== undefined && KNOWLEDGE_STATUSES.has(input.status)
      ? input.status
      : undefined;
  const category =
    input.category !== undefined && KNOWLEDGE_CATEGORIES.has(input.category)
      ? input.category
      : undefined;
  const content =
    input.content !== undefined
      ? String(input.content || "").trim().slice(0, 200000)
      : undefined;

  if (input.title !== undefined && !title) {
    throw new Error("Titolo Knowledge obbligatorio.");
  }
  if (input.content !== undefined && !content) {
    throw new Error("Contenuto Knowledge obbligatorio.");
  }

  await sql.begin("read write", async (tx) => {
    if (title !== undefined) {
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "title"=$2,"updatedAt"=now() WHERE "id"=$1',
        [id, title],
      );
    }
    if (status !== undefined) {
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "status"=$2::"KnowledgeDocumentStatus","updatedAt"=now() WHERE "id"=$1',
        [id, status],
      );
    }
    if (category !== undefined) {
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "category"=$2::"KnowledgeCategory","updatedAt"=now() WHERE "id"=$1',
        [id, category],
      );
    }

    if ("serviceType" in input) {
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "serviceType"=$2,"updatedAt"=now() WHERE "id"=$1',
        [
          id,
          KNOWLEDGE_SERVICES.has(input.serviceType)
            ? input.serviceType
            : null,
        ],
      );
    }

    if ("assistanceArea" in input) {
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "assistanceArea"=$2,"updatedAt"=now() WHERE "id"=$1',
        [
          id,
          KNOWLEDGE_AREAS.has(input.assistanceArea)
            ? input.assistanceArea
            : null,
        ],
      );
    }

    const scalarFields = [
      ["description", "description", 2000],
      ["topic", "topic", 120],
      ["tags", "tags", 1000],
      ["usageHints", "usageHints", 2000],
      ["deviceScope", "deviceScope", 200],
    ];

    for (const [inputKey, column, max] of scalarFields) {
      if (!(inputKey in input)) continue;
      const value = safeKnowledgeScalar(input[inputKey], max);
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "' +
          column +
          '"=$2,"updatedAt"=now() WHERE "id"=$1',
        [id, value],
      );
    }

    if (content !== undefined) {
      const chunks = knowledgeChunks(content);
      await tx.unsafe(
        'DELETE FROM "KnowledgeChunk" WHERE "documentId"=$1',
        [id],
      );
      for (let index = 0; index < chunks.length; index += 1) {
        await tx.unsafe(
          'INSERT INTO "KnowledgeChunk" ("id","content","order","createdAt","documentId") VALUES ($1,$2,$3,now(),$4)',
          [randomUUID(), chunks[index], index, id],
        );
      }
      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET "fileSize"=$2,"updatedAt"=now() WHERE "id"=$1',
        [id, Buffer.byteLength(content, "utf8")],
      );
    }
  });

  return id;
}


export async function getKnowledgeDocumentById(id) {
  await ensureGemmaSchema();
  const sql = db();

  const rows = await sql.unsafe(
    'SELECT "id"::text AS id,"title"::text AS title,"description"::text AS description,' +
    '"category"::text AS category,"serviceType"::text AS service_type,' +
    '"assistanceArea"::text AS assistance_area,"topic"::text AS topic,' +
    '"status"::text AS status,"tags"::text AS tags,"sourceType"::text AS source_type,' +
    '"usageHints"::text AS usage_hints,"deviceScope"::text AS device_scope,' +
    '"fileName"::text AS file_name,"updatedAt" AS updated_at ' +
    'FROM "KnowledgeDocument" WHERE "id"=$1 LIMIT 1',
    [id],
  );

  if (!rows[0]) return null;

  const chunks = await sql.unsafe(
    'SELECT "id"::text AS id,"content"::text AS content,"order"::int AS "order" ' +
    'FROM "KnowledgeChunk" WHERE "documentId"=$1 ORDER BY "order" ASC',
    [id],
  );

  return {
    ...rows[0],
    chunks,
    content: chunks.map((item) => item.content).join("\n\n"),
  };
}
