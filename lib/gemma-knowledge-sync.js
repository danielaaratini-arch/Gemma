import * as cheerio from "cheerio";
import { createHash, randomUUID } from "node:crypto";
import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";
import {
  KNOWLEDGE_INGEST_REVISION,
  buildImportedCorpusHashFromContent,
  buildImportedVirtualFileName,
  equivalentImportedUrls,
  normalizeImportedUrl,
  prepareImportedKnowledgePage,
  shouldIgnoreImportedUrl,
  splitImportedText,
} from "./gemma-knowledge-ingest";

const SOURCES = [
  {
    name: "Tiscali Assistenza",
    type: "faq",
    root: "https://assistenza.tiscali.it/",
    maxPages: 1000,
    seeds: [
      "https://assistenza.tiscali.it/mobile/",
      "https://assistenza.tiscali.it/mobile/guida/configurazione-servizi/",
    ],
  },
  {
    name: "Tiscali Casa",
    type: "web",
    root: "https://casa.tiscali.it/",
    maxPages: 100,
    seeds: [],
  },
  {
    name: "Tiscali Business",
    type: "web",
    root: "https://business.tiscali.it/partitaiva/",
    maxPages: 100,
    seeds: [],
  },
];

const MIN_CONTENT_LENGTH = 80;
let schemaPromise = null;

function db() {
  const sql = operationalDb();
  if (!sql) throw new Error("Database non disponibile.");
  return sql;
}

function clean(value, max = 200000) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function sourceAllows(source, urlValue) {
  try {
    const root = new URL(source.root);
    const url = new URL(urlValue);
    if (url.hostname.toLowerCase() !== root.hostname.toLowerCase()) return false;
    const prefix = root.pathname === "/" ? "/" : root.pathname.replace(/\/+$/, "/");
    return prefix === "/" || url.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

function corpusHash(input) {
  return hash(
    [
      clean(input.title, 1000),
      clean(input.description, 3000),
      clean(input.content),
    ]
      .join("\n\n")
      .toLowerCase(),
  );
}

async function syncSchemaReady() {
  const rows = await db().unsafe(
    "SELECT " +
      "to_regclass('gemma.knowledge_sync_job') IS NOT NULL AS job," +
      "to_regclass('gemma.knowledge_sync_queue') IS NOT NULL AS queue," +
      "to_regclass('gemma.knowledge_proposal') IS NOT NULL AS proposal," +
      "to_regclass('gemma.knowledge_snapshot') IS NOT NULL AS snapshot," +
      "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gemma' AND table_name='knowledge_sync_job' AND column_name='ingest_revision') AS ingest_revision",
  );

  return Boolean(
    rows[0]?.job &&
      rows[0]?.queue &&
      rows[0]?.proposal &&
      rows[0]?.snapshot &&
      rows[0]?.ingest_revision,
  );
}

export async function migrateKnowledgeSyncSchema() {
  await ensureGemmaSchema();
  const sql = db();

  await sql.unsafe(
    "CREATE TABLE IF NOT EXISTS gemma.knowledge_sync_job (" +
      "id TEXT PRIMARY KEY," +
      "status TEXT NOT NULL," +
      "phase TEXT NOT NULL," +
      "created_by TEXT NOT NULL," +
      "ingest_revision TEXT," +
      "processed INTEGER NOT NULL DEFAULT 0," +
      "discovered INTEGER NOT NULL DEFAULT 0," +
      "proposals INTEGER NOT NULL DEFAULT 0," +
      "errors INTEGER NOT NULL DEFAULT 0," +
      "error_message TEXT," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "completed_at TIMESTAMPTZ" +
    ")",
  );

  await sql.unsafe(
    "ALTER TABLE gemma.knowledge_sync_job " +
      "ADD COLUMN IF NOT EXISTS ingest_revision TEXT",
  );

  await sql.unsafe(
    "CREATE TABLE IF NOT EXISTS gemma.knowledge_sync_queue (" +
      "id TEXT PRIMARY KEY," +
      "job_id TEXT NOT NULL REFERENCES gemma.knowledge_sync_job(id) ON DELETE CASCADE," +
      "source_name TEXT NOT NULL," +
      "source_root TEXT NOT NULL," +
      "source_limit INTEGER NOT NULL," +
      "url TEXT NOT NULL," +
      "depth INTEGER NOT NULL DEFAULT 0," +
      "status TEXT NOT NULL DEFAULT 'PENDING'," +
      "error_message TEXT," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "UNIQUE(job_id,url)" +
    ")",
  );

  await sql.unsafe(
    "CREATE INDEX IF NOT EXISTS gemma_knowledge_sync_queue_idx " +
      "ON gemma.knowledge_sync_queue(job_id,status,depth,created_at)",
  );

  await sql.unsafe(
    "CREATE TABLE IF NOT EXISTS gemma.knowledge_proposal (" +
      "id TEXT PRIMARY KEY," +
      "job_id TEXT NOT NULL REFERENCES gemma.knowledge_sync_job(id) ON DELETE CASCADE," +
      "proposal_key TEXT NOT NULL," +
      "action TEXT NOT NULL," +
      "source_name TEXT NOT NULL," +
      "source_url TEXT NOT NULL," +
      "existing_document_id TEXT," +
      "title TEXT NOT NULL," +
      "description TEXT," +
      "content_text TEXT," +
      "current_hash TEXT," +
      "next_hash TEXT NOT NULL," +
      "metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "selected BOOLEAN NOT NULL DEFAULT false," +
      "applied_at TIMESTAMPTZ," +
      "apply_error TEXT," +
      "apply_claimed_at TIMESTAMPTZ," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "UNIQUE(job_id,proposal_key)" +
    ")",
  );

  await sql.unsafe(
    "CREATE INDEX IF NOT EXISTS gemma_knowledge_proposal_job_idx " +
      "ON gemma.knowledge_proposal(job_id,action,applied_at)",
  );

  await sql.unsafe(
    "ALTER TABLE gemma.knowledge_proposal " +
      "ADD COLUMN IF NOT EXISTS apply_claimed_at TIMESTAMPTZ",
  );

  await sql.unsafe(
    "CREATE TABLE IF NOT EXISTS gemma.knowledge_snapshot (" +
      "id TEXT PRIMARY KEY," +
      "job_id TEXT NOT NULL REFERENCES gemma.knowledge_sync_job(id) ON DELETE CASCADE," +
      "proposal_id TEXT NOT NULL," +
      "kind TEXT NOT NULL," +
      "document_id TEXT," +
      "snapshot_json JSONB," +
      "restored_at TIMESTAMPTZ," +
      "restore_claimed_at TIMESTAMPTZ," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
      "UNIQUE(job_id,proposal_id)" +
    ")",
  );

  await sql.unsafe(
    "ALTER TABLE gemma.knowledge_snapshot " +
      "ADD COLUMN IF NOT EXISTS restore_claimed_at TIMESTAMPTZ",
  );

  return true;
}

async function ensureSyncSchema() {
  await ensureGemmaSchema();

  const productionNoAutoMigrate =
    process.env.VERCEL_ENV === "production" &&
    String(process.env.GEMMA_AUTO_MIGRATE || "").toLowerCase() !== "true";

  if (productionNoAutoMigrate) {
    if (!(await syncSchemaReady())) {
      throw new Error(
        "Schema Knowledge Sync non aggiornato. Esegui npm run migrate:gemma prima della production.",
      );
    }
    return true;
  }

  if (!schemaPromise) {
    schemaPromise = migrateKnowledgeSyncSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function existingKnowledgeForUrl(sql, urlValue, fileName) {
  const variants = equivalentImportedUrls(urlValue);
  const rows = await sql.unsafe(
    "SELECT " +
      'd."id"::text AS id,' +
      'd."title"::text AS title,' +
      'd."description"::text AS description,' +
      'd."category"::text AS category,' +
      'd."department"::text AS department,' +
      'd."customerType"::text AS customer_type,' +
      'd."serviceType"::text AS service_type,' +
      'd."assistanceArea"::text AS assistance_area,' +
      'd."topic"::text AS topic,' +
      'd."status"::text AS status,' +
      'd."version"::text AS version,' +
      'd."tags"::text AS tags,' +
      'd."sourceType"::text AS source_type,' +
      'd."usageHints"::text AS usage_hints,' +
      'd."deviceScope"::text AS device_scope,' +
      'd."fileId"::text AS file_id,' +
      'd."fileName"::text AS file_name,' +
      'd."fileSize"::int AS file_size,' +
      'd."fileType"::text AS file_type,' +
      'd."fileUrl"::text AS file_url,' +
      'd."createdAt" AS created_at,' +
      'd."updatedAt" AS updated_at ' +
    'FROM "KnowledgeDocument" d ' +
    'WHERE d."fileUrl" = ANY($1::text[]) OR (d."sourceType"=\'WEB_SYNC\' AND d."fileName"=$2) ' +
    'ORDER BY CASE WHEN d."fileUrl"=$3 THEN 0 WHEN d."status"=\'ARCHIVED\'::"KnowledgeDocumentStatus" THEN 1 ELSE 2 END,' +
    'd."updatedAt" DESC LIMIT 1',
    [variants, fileName, urlValue],
  );

  const document = rows[0];
  if (!document) return null;

  const chunks = await sql.unsafe(
    'SELECT "id"::text AS id,"content"::text AS content,"order"::int AS "order" ' +
    'FROM "KnowledgeChunk" WHERE "documentId"=$1 ORDER BY "order" ASC',
    [document.id],
  );

  return {
    ...document,
    chunks,
    content: chunks.map((item) => item.content).join("\n\n"),
  };
}

function snapshotDocument(document) {
  return {
    id: document.id,
    title: document.title,
    description: document.description,
    category: document.category,
    department: document.department,
    customerType: document.customer_type,
    serviceType: document.service_type,
    assistanceArea: document.assistance_area,
    topic: document.topic,
    status: document.status,
    version: document.version,
    tags: document.tags,
    sourceType: document.source_type,
    usageHints: document.usage_hints,
    deviceScope: document.device_scope,
    fileId: document.file_id,
    fileName: document.file_name,
    fileSize: document.file_size,
    fileType: document.file_type,
    fileUrl: document.file_url,
    chunks: document.chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      order: chunk.order,
    })),
  };
}

function corpusVocabulary(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .slice(0, 5000),
  );
}

function corpusOverlap(previous, next) {
  const left = corpusVocabulary(previous);
  const right = corpusVocabulary(next);
  if (!left.size || !right.size) return 1;

  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  return common / Math.min(left.size, right.size);
}

function proposalSafety(action, existing, page) {
  if (action === "ARCHIVE") {
    return {
      status: "REVIEW",
      reason:
        "Le archiviazioni rilevate dal crawler richiedono conferma manuale.",
    };
  }

  if (action === "CREATE") {
    if (page?.documentData?.targetStatus === "ARCHIVED") {
      return {
        status: "SAFE",
        reason:
          "Il catalogo commerciale viene creato come tombstone ARCHIVED e non entra nel retrieval.",
      };
    }

    return {
      status: "SAFE",
      reason:
        "Il nuovo documento verrà creato come DRAFT e non entrerà nel retrieval finché non viene attivato.",
    };
  }

  if (!existing || existing.source_type !== "WEB_SYNC") {
    return {
      status: "REVIEW",
      reason:
        "Gemma non sovrascrive automaticamente documenti manuali o curati.",
    };
  }

  const previous = clean(existing.content || "");
  const next = clean(page?.content || "");

  if (!next || next.length < MIN_CONTENT_LENGTH) {
    return {
      status: "REVIEW",
      reason: "Il corpus estratto è troppo corto.",
    };
  }

  if (/\uFFFD/.test(next) || /Radware Captcha Page/i.test(next)) {
    return {
      status: "REVIEW",
      reason: "Il corpus contiene segnali di estrazione non affidabile.",
    };
  }

  if (previous.length > 0) {
    const ratio = next.length / previous.length;
    if (ratio < 0.7 || ratio > 1.8) {
      return {
        status: "REVIEW",
        reason:
          "La dimensione del corpus è cambiata troppo rispetto al documento attuale.",
      };
    }

    if (corpusOverlap(previous, next) < 0.35) {
      return {
        status: "REVIEW",
        reason:
          "Il nuovo corpus è semanticamente troppo distante dal documento attuale.",
      };
    }
  }

  return {
    status: "SAFE",
    reason:
      "Aggiornamento estratto con la pipeline di ingest Lia/Alda e compatibile con il WEB_SYNC esistente.",
  };
}

async function saveProposal(input) {
  const { jobId, source, url, page, actionOverride } = input;
  const sql = db();
  const metadata = page?.documentData || {
    category: source.type === "faq" ? "FAQ" : "GENERAL",
    sourceType: "WEB_SYNC",
    fileName: buildImportedVirtualFileName(url),
  };
  const existing = await existingKnowledgeForUrl(sql, url, metadata.fileName);

  if (actionOverride === "ARCHIVE") {
    if (!existing || existing.status === "ARCHIVED") return null;

    const current = corpusHash({
      title: existing.title,
      description: existing.description,
      content: existing.content,
    });

    const safety = proposalSafety("ARCHIVE", existing, null);
    const proposalMetadata = {
      ...metadata,
      ingestRevision: KNOWLEDGE_INGEST_REVISION,
      safetyStatus: safety.status,
      safetyReason: safety.reason,
      previousPreview: clean(existing.content || "", 2200),
      nextPreview: "",
    };

    const rows = await sql.unsafe(
      "INSERT INTO gemma.knowledge_proposal " +
      "(id,job_id,proposal_key,action,source_name,source_url,existing_document_id,title,description,content_text,current_hash,next_hash,metadata_json,created_at,updated_at) " +
      "VALUES ($1,$2,$3,'ARCHIVE',$4,$5,$6,$7,$8,NULL,$9,$9,$10::jsonb,now(),now()) " +
      "ON CONFLICT (job_id,proposal_key) DO UPDATE SET " +
      "action='ARCHIVE',existing_document_id=EXCLUDED.existing_document_id,title=EXCLUDED.title,description=EXCLUDED.description,current_hash=EXCLUDED.current_hash,next_hash=EXCLUDED.next_hash,metadata_json=EXCLUDED.metadata_json,updated_at=now() " +
      "RETURNING *",
      [
        randomUUID(),
        jobId,
        "archive:" + url,
        source.name,
        url,
        existing.id,
        existing.title,
        existing.description,
        current,
        JSON.stringify(proposalMetadata),
      ],
    );
    return rows[0] || null;
  }

  if (!page || page.ignored || page.content.length < MIN_CONTENT_LENGTH) return null;

  if (
    existing &&
    existing.status === "ARCHIVED" &&
    existing.source_type === "WEB_SYNC"
  ) {
    return null;
  }

  if (page.nonInformativeShell) {
    if (existing && existing.source_type === "WEB_SYNC" && existing.status !== "ARCHIVED") {
      return await saveProposal({
        jobId,
        source,
        url,
        page: null,
        actionOverride: "ARCHIVE",
      });
    }
    return null;
  }

  const currentHash = existing
    ? corpusHash({
        title: existing.title,
        description: existing.description,
        content: existing.content,
      })
    : null;
  const nextHash = corpusHash({
    title: page.title,
    description: page.description,
    content: page.content,
  });

  const existingCorpusHash = existing
    ? buildImportedCorpusHashFromContent(existing.content, existing.title)
    : null;
  const corpusChanged = !existing || existingCorpusHash !== page.corpusHash;

  const semanticComplete = Boolean(
    existing?.service_type &&
    existing?.assistance_area &&
    existing?.topic,
  );

  const metadataChanged = existing
    ? [
        ["description", metadata.description],
        ["tags", metadata.tags],
        ["file_id", metadata.fileId],
        ["file_name", metadata.fileName],
        ["file_size", metadata.fileSize],
        ["file_type", metadata.fileType],
        ["file_url", metadata.fileUrl],
        ["device_scope", metadata.deviceScope],
        ...(!semanticComplete
          ? [
              ["service_type", metadata.serviceType],
              ["assistance_area", metadata.assistanceArea],
              ["topic", metadata.topic],
              ["customer_type", metadata.customerType],
            ]
          : []),
        ...(metadata.targetStatus === "ARCHIVED"
          ? [["status", "ARCHIVED"]]
          : []),
      ].some(([field, value]) => (existing?.[field] ?? null) !== (value ?? null))
    : true;

  if (existing && !corpusChanged && !metadataChanged) return null;

  const action = existing ? "UPDATE" : "CREATE";
  const proposalKey = action.toLowerCase() + ":" + url;
  const safety = proposalSafety(action, existing, page);
  const proposalMetadata = {
    ...metadata,
    ingestRevision: KNOWLEDGE_INGEST_REVISION,
    corpusHash: page.corpusHash,
    contentHash: page.contentHash,
    corpusChanged,
    metadataChanged,
    safetyStatus: safety.status,
    safetyReason: safety.reason,
    previousPreview: existing
      ? clean(existing.content || "", 2200)
      : "",
    nextPreview: clean(page.content || "", 2200),
  };

  const rows = await sql.unsafe(
    "INSERT INTO gemma.knowledge_proposal " +
    "(id,job_id,proposal_key,action,source_name,source_url,existing_document_id,title,description,content_text,current_hash,next_hash,metadata_json,created_at,updated_at) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now()) " +
    "ON CONFLICT (job_id,proposal_key) DO UPDATE SET " +
    "action=EXCLUDED.action,existing_document_id=EXCLUDED.existing_document_id,title=EXCLUDED.title,description=EXCLUDED.description,content_text=EXCLUDED.content_text,current_hash=EXCLUDED.current_hash,next_hash=EXCLUDED.next_hash,metadata_json=EXCLUDED.metadata_json,updated_at=now() " +
    "RETURNING *",
    [
      randomUUID(),
      jobId,
      proposalKey,
      action,
      source.name,
      url,
      existing ? existing.id : null,
      existing?.title || page.title,
      page.description,
      page.content,
      currentHash,
      nextHash,
      JSON.stringify(proposalMetadata),
    ],
  );

  return rows[0] || null;
}

async function refreshJob(jobId) {
  const sql = db();
  const queue = await sql.unsafe(
    "SELECT count(*)::int AS discovered," +
    "count(*) FILTER (WHERE status IN ('DONE','ERROR'))::int AS processed," +
    "count(*) FILTER (WHERE status='PENDING')::int AS pending," +
    "count(*) FILTER (WHERE status='PROCESSING')::int AS processing," +
    "count(*) FILTER (WHERE status='ERROR')::int AS errors " +
    "FROM gemma.knowledge_sync_queue WHERE job_id=$1",
    [jobId],
  );
  const proposals = await sql.unsafe(
    "SELECT count(*)::int AS count FROM gemma.knowledge_proposal WHERE job_id=$1",
    [jobId],
  );

  const q = queue[0] || {};
  const finished =
    Number(q.pending || 0) === 0 && Number(q.processing || 0) === 0;

  await sql.unsafe(
    "UPDATE gemma.knowledge_sync_job SET " +
    "processed=$2,discovered=$3,proposals=$4,errors=$5," +
    "status=CASE WHEN $6 THEN 'PREVIEW_READY' ELSE status END," +
    "phase=CASE WHEN $6 THEN 'PREVIEW_READY' ELSE phase END," +
    "completed_at=CASE WHEN $6 THEN coalesce(completed_at,now()) ELSE completed_at END," +
    "updated_at=now() WHERE id=$1",
    [
      jobId,
      Number(q.processed || 0),
      Number(q.discovered || 0),
      Number(proposals[0]?.count || 0),
      Number(q.errors || 0),
      finished,
    ],
  );

  return await getKnowledgeSyncJob(jobId);
}

async function fetchPage(urlValue) {
  const response = await fetch(urlValue, {
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "it-IT,it;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; GemmaKnowledgeSync/2.0)",
    },
  });

  if (response.status === 404 || response.status === 410) {
    return { removed: true, status: response.status };
  }
  if (!response.ok) throw new Error("HTTP " + response.status);

  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) {
    throw new Error("Contenuto non HTML");
  }

  const html = await response.text();
  const finalUrl = normalizeImportedUrl(response.url, urlValue) || urlValue;

  if (
    /Radware Captcha Page/i.test(html) ||
    new URL(finalUrl).hostname.toLowerCase() === "validate.perfdrive.com"
  ) {
    throw new Error("Sorgente temporaneamente bloccata da Radware");
  }

  return {
    removed: false,
    finalUrl,
    html,
  };
}

async function enqueueDiscovered(jobId, source, links, depth) {
  const sql = db();
  const countRows = await sql.unsafe(
    "SELECT count(*)::int AS count FROM gemma.knowledge_sync_queue WHERE job_id=$1 AND source_name=$2",
    [jobId, source.name],
  );

  let remaining = Math.max(
    0,
    Number(source.maxPages) - Number(countRows[0]?.count || 0),
  );

  let inserted = 0;
  for (const link of links) {
    if (!remaining) break;
    if (shouldIgnoreImportedUrl(link)) continue;
    if (!sourceAllows(source, link)) continue;

    const rows = await sql.unsafe(
      "INSERT INTO gemma.knowledge_sync_queue " +
      "(id,job_id,source_name,source_root,source_limit,url,depth,status,created_at,updated_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',now(),now()) " +
      "ON CONFLICT (job_id,url) DO NOTHING RETURNING id",
      [
        randomUUID(),
        jobId,
        source.name,
        source.root,
        source.maxPages,
        link,
        depth,
      ],
    );

    if (rows[0]) {
      inserted += 1;
      remaining -= 1;
    }
  }

  return inserted;
}

export async function startKnowledgePreview(createdBy) {
  await ensureSyncSchema();
  const sql = db();
  const jobId = randomUUID();

  await sql.unsafe(
    "INSERT INTO gemma.knowledge_sync_job " +
    "(id,status,phase,created_by,ingest_revision,created_at,updated_at) " +
    "VALUES ($1,'PREVIEWING','PREVIEW',$2,$3,now(),now())",
    [
      jobId,
      String(createdBy || "Admin").slice(0, 120),
      KNOWLEDGE_INGEST_REVISION,
    ],
  );

  for (const source of SOURCES) {
    const initial = [source.root, ...source.seeds]
      .map((value) => normalizeImportedUrl(value, source.root))
      .filter(Boolean);

    for (const url of [...new Set(initial)]) {
      await sql.unsafe(
        "INSERT INTO gemma.knowledge_sync_queue " +
        "(id,job_id,source_name,source_root,source_limit,url,depth,status,created_at,updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,0,'PENDING',now(),now()) " +
        "ON CONFLICT (job_id,url) DO NOTHING",
        [randomUUID(), jobId, source.name, source.root, source.maxPages, url],
      );
    }
  }

  return await refreshJob(jobId);
}

export async function stepKnowledgePreview(jobId, batchSize = 6) {
  await ensureSyncSchema();
  const sql = db();
  const safeBatch = Math.max(1, Math.min(10, Number(batchSize) || 6));

  await sql.unsafe(
    "UPDATE gemma.knowledge_sync_queue SET status='PENDING',updated_at=now() " +
    "WHERE job_id=$1 AND status='PROCESSING' AND updated_at < now() - interval '2 minutes'",
    [jobId],
  );

  const claimed = await sql.begin("read write", async (tx) => {
    return await tx.unsafe(
      "WITH picked AS (" +
      "SELECT id FROM gemma.knowledge_sync_queue " +
      "WHERE job_id=$1 AND status='PENDING' " +
      "ORDER BY depth ASC,created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED" +
      ") UPDATE gemma.knowledge_sync_queue q " +
      "SET status='PROCESSING',updated_at=now() FROM picked " +
      "WHERE q.id=picked.id RETURNING q.*",
      [jobId, safeBatch],
    );
  });

  if (!claimed.length) return await refreshJob(jobId);

  const sourceByName = new Map(SOURCES.map((item) => [item.name, item]));

  const results = await Promise.allSettled(
    claimed.map(async (item) => {
      const source = sourceByName.get(item.source_name);
      if (!source) throw new Error("Sorgente non configurata.");

      const result = await fetchPage(item.url);

      if (result.removed) {
        await saveProposal({
          jobId,
          source,
          url: item.url,
          page: null,
          actionOverride: "ARCHIVE",
        });
        return { source, links: [] };
      }

      const prepared = prepareImportedKnowledgePage(
        {
          name: source.name,
          type: source.type,
          url: source.root,
        },
        result.finalUrl,
        result.html,
      );

      if (!prepared.ignored) {
        await saveProposal({
          jobId,
          source,
          url: result.finalUrl,
          page: {
            ...prepared.page,
            ...prepared,
          },
        });
      }

      return {
        source,
        links: prepared.links || [],
      };
    }),
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const item = claimed[index];

    if (result.status === "fulfilled") {
      await sql.unsafe(
        "UPDATE gemma.knowledge_sync_queue SET status='DONE',error_message=NULL,updated_at=now() WHERE id=$1",
        [item.id],
      );

      await enqueueDiscovered(
        jobId,
        result.value.source,
        result.value.links,
        Number(item.depth || 0) + 1,
      );
    } else {
      await sql.unsafe(
        "UPDATE gemma.knowledge_sync_queue SET status='ERROR',error_message=$2,updated_at=now() WHERE id=$1",
        [
          item.id,
          String(result.reason?.message || result.reason || "Errore fetch").slice(
            0,
            1000,
          ),
        ],
      );
    }
  }

  return await refreshJob(jobId);
}

export async function getKnowledgeSyncJob(jobId) {
  await ensureSyncSchema();
  const sql = db();

  const jobs = await sql.unsafe(
    "SELECT * FROM gemma.knowledge_sync_job WHERE id=$1 LIMIT 1",
    [jobId],
  );
  if (!jobs[0]) return null;

  const proposals = await sql.unsafe(
    "SELECT id,proposal_key,action,source_name,source_url,existing_document_id," +
    "title,description,current_hash,next_hash,metadata_json,selected,applied_at,apply_error,created_at,updated_at " +
    "FROM gemma.knowledge_proposal WHERE job_id=$1 " +
    "ORDER BY CASE action WHEN 'CREATE' THEN 0 WHEN 'UPDATE' THEN 1 ELSE 2 END,source_name,title",
    [jobId],
  );

  const queue = await sql.unsafe(
    "SELECT source_name,count(*)::int AS discovered," +
    "count(*) FILTER (WHERE status IN ('DONE','ERROR'))::int AS processed," +
    "count(*) FILTER (WHERE status='PENDING')::int AS pending," +
    "count(*) FILTER (WHERE status='ERROR')::int AS errors " +
    "FROM gemma.knowledge_sync_queue WHERE job_id=$1 GROUP BY source_name ORDER BY source_name",
    [jobId],
  );

  const snapshots = await sql.unsafe(
    "SELECT count(*)::int AS total," +
    "count(*) FILTER (WHERE restored_at IS NOT NULL)::int AS restored " +
    "FROM gemma.knowledge_snapshot WHERE job_id=$1",
    [jobId],
  );

  return {
    ...jobs[0],
    proposals,
    queue,
    snapshots: snapshots[0] || { total: 0, restored: 0 },
  };
}

async function currentDocumentById(tx, id) {
  const rows = await tx.unsafe(
    "SELECT " +
      'd."id"::text AS id,' +
      'd."title"::text AS title,' +
      'd."description"::text AS description,' +
      'd."category"::text AS category,' +
      'd."department"::text AS department,' +
      'd."customerType"::text AS customer_type,' +
      'd."serviceType"::text AS service_type,' +
      'd."assistanceArea"::text AS assistance_area,' +
      'd."topic"::text AS topic,' +
      'd."status"::text AS status,' +
      'd."version"::text AS version,' +
      'd."tags"::text AS tags,' +
      'd."sourceType"::text AS source_type,' +
      'd."usageHints"::text AS usage_hints,' +
      'd."deviceScope"::text AS device_scope,' +
      'd."fileId"::text AS file_id,' +
      'd."fileName"::text AS file_name,' +
      'd."fileSize"::int AS file_size,' +
      'd."fileType"::text AS file_type,' +
      'd."fileUrl"::text AS file_url ' +
    'FROM "KnowledgeDocument" d WHERE d."id"=$1 LIMIT 1',
    [id],
  );

  if (!rows[0]) return null;

  const chunks = await tx.unsafe(
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

async function applyOneProposal(jobId, proposal) {
  const sql = db();
  const safetyStatus =
    proposal?.metadata_json?.safetyStatus || "REVIEW";

  if (safetyStatus !== "SAFE") {
    await sql.unsafe(
      "UPDATE gemma.knowledge_proposal SET apply_error=$2,apply_claimed_at=NULL,updated_at=now() WHERE id=$1",
      [
        proposal.id,
        "Proposta non applicabile automaticamente: " +
          (proposal?.metadata_json?.safetyReason || "revisione richiesta"),
      ],
    );
    return false;
  }

  try {
    await sql.begin("read write", async (tx) => {
      let document = null;
      const metadata = proposal.metadata_json || {};

      if (proposal.existing_document_id) {
        document = await currentDocumentById(tx, proposal.existing_document_id);
        if (!document) throw new Error("Documento Knowledge non trovato.");

        const current = corpusHash({
          title: document.title,
          description: document.description,
          content: document.content,
        });

        if (proposal.current_hash && current !== proposal.current_hash) {
          throw new Error(
            "Il documento è cambiato dopo la Preview. Genera una nuova Preview.",
          );
        }
      }

      if (proposal.action === "CREATE") {
        const fileName =
          metadata.fileName || buildImportedVirtualFileName(proposal.source_url);
        const variants = equivalentImportedUrls(proposal.source_url);
        const duplicates = await tx.unsafe(
          'SELECT "id"::text AS id FROM "KnowledgeDocument" ' +
            'WHERE "fileUrl" = ANY($1::text[]) OR ("sourceType"=\'WEB_SYNC\' AND "fileName"=$2) ' +
            'LIMIT 1',
          [variants, fileName],
        );

        if (duplicates[0]) {
          throw new Error(
            "La Knowledge è cambiata dopo la Preview: il documento esiste già.",
          );
        }

        const id = randomUUID();
        const chunks = splitImportedText(proposal.content_text || "");
        if (!chunks.length) throw new Error("Corpus vuoto.");

        const targetStatus =
          metadata.targetStatus === "ARCHIVED" ? "ARCHIVED" : "DRAFT";

        await tx.unsafe(
          'INSERT INTO "KnowledgeDocument" (' +
          '"id","title","description","category","department","customerType","serviceType",' +
          '"assistanceArea","topic","status","version","tags","sourceType","usageHints",' +
          '"deviceScope","fileId","fileName","fileSize","fileType","fileUrl","createdAt","updatedAt"' +
          ') VALUES ($1,$2,$3,$4::"KnowledgeCategory",NULL,$5,$6,$7,$8,' +
          '$9::"KnowledgeDocumentStatus",\'1.0\',$10,\'WEB_SYNC\',NULL,$11,' +
          '$12,$13,$14,\'text/html\',$15,now(),now())',
          [
            id,
            proposal.title,
            proposal.description,
            metadata.category || "GENERAL",
            metadata.customerType || null,
            metadata.serviceType || null,
            metadata.assistanceArea || null,
            metadata.topic || null,
            targetStatus,
            metadata.tags || null,
            metadata.deviceScope || null,
            metadata.fileId || "gemma-web-" + hash(proposal.source_url).slice(0, 24),
            fileName,
            Number(metadata.fileSize || Buffer.byteLength(proposal.content_text || "", "utf8")),
            proposal.source_url,
          ],
        );

        for (let index = 0; index < chunks.length; index += 1) {
          await tx.unsafe(
            'INSERT INTO "KnowledgeChunk" ("id","content","order","createdAt","documentId") ' +
            "VALUES ($1,$2,$3,now(),$4)",
            [randomUUID(), chunks[index], index, id],
          );
        }

        await tx.unsafe(
          "INSERT INTO gemma.knowledge_snapshot " +
          "(id,job_id,proposal_id,kind,document_id,snapshot_json,created_at) " +
          "VALUES ($1,$2,$3,'CREATED',$4,NULL,now()) " +
          "ON CONFLICT (job_id,proposal_id) DO NOTHING",
          [randomUUID(), jobId, proposal.id, id],
        );
      } else if (proposal.action === "UPDATE") {
        if (!document) throw new Error("Documento Knowledge non trovato.");
        const chunks = splitImportedText(proposal.content_text || "");
        if (!chunks.length) throw new Error("Corpus vuoto.");

        await tx.unsafe(
          "INSERT INTO gemma.knowledge_snapshot " +
          "(id,job_id,proposal_id,kind,document_id,snapshot_json,created_at) " +
          "VALUES ($1,$2,$3,'UPDATED',$4,$5::jsonb,now()) " +
          "ON CONFLICT (job_id,proposal_id) DO NOTHING",
          [
            randomUUID(),
            jobId,
            proposal.id,
            document.id,
            JSON.stringify(snapshotDocument(document)),
          ],
        );

        const semanticComplete = Boolean(
          document.service_type &&
          document.assistance_area &&
          document.topic,
        );
        const nextService =
          semanticComplete ? document.service_type : metadata.serviceType || document.service_type;
        const nextArea =
          semanticComplete ? document.assistance_area : metadata.assistanceArea || document.assistance_area;
        const nextTopic =
          semanticComplete ? document.topic : metadata.topic || document.topic;
        const nextCustomerType =
          document.customer_type || metadata.customerType || null;
        const nextStatus =
          metadata.targetStatus === "ARCHIVED"
            ? "ARCHIVED"
            : document.status;
        const legacyCommercialCategory =
          metadata.targetStatus === "ARCHIVED" &&
          document.category === "COMMERCIAL" &&
          !document.service_type &&
          !document.assistance_area &&
          !document.customer_type &&
          !document.topic;
        const nextCategory =
          legacyCommercialCategory ? "GENERAL" : document.category;

        await tx.unsafe(
          'UPDATE "KnowledgeDocument" SET ' +
          '"description"=$2,"category"=$3::"KnowledgeCategory","customerType"=$4,' +
          '"serviceType"=$5,"assistanceArea"=$6,"topic"=$7,' +
          '"status"=$8::"KnowledgeDocumentStatus","tags"=$9,"deviceScope"=$10,' +
          '"fileId"=$11,"fileUrl"=$12,"fileName"=$13,"fileSize"=$14,' +
          '"fileType"=\'text/html\',"sourceType"=\'WEB_SYNC\',"updatedAt"=now() ' +
          'WHERE "id"=$1',
          [
            document.id,
            proposal.description,
            nextCategory,
            nextCustomerType,
            nextService,
            nextArea,
            nextTopic,
            nextStatus,
            metadata.tags || document.tags,
            metadata.deviceScope || document.device_scope,
            metadata.fileId || document.file_id,
            proposal.source_url,
            metadata.fileName || buildImportedVirtualFileName(proposal.source_url),
            Number(metadata.fileSize || Buffer.byteLength(proposal.content_text || "", "utf8")),
          ],
        );

        if (metadata.corpusChanged !== false) {
          await tx.unsafe(
            'DELETE FROM "KnowledgeChunk" WHERE "documentId"=$1',
            [document.id],
          );

          for (let index = 0; index < chunks.length; index += 1) {
            await tx.unsafe(
              'INSERT INTO "KnowledgeChunk" ("id","content","order","createdAt","documentId") ' +
              "VALUES ($1,$2,$3,now(),$4)",
              [randomUUID(), chunks[index], index, document.id],
            );
          }
        }
      } else if (proposal.action === "ARCHIVE") {
        if (!document) throw new Error("Documento Knowledge non trovato.");

        await tx.unsafe(
          "INSERT INTO gemma.knowledge_snapshot " +
          "(id,job_id,proposal_id,kind,document_id,snapshot_json,created_at) " +
          "VALUES ($1,$2,$3,'ARCHIVED',$4,$5::jsonb,now()) " +
          "ON CONFLICT (job_id,proposal_id) DO NOTHING",
          [
            randomUUID(),
            jobId,
            proposal.id,
            document.id,
            JSON.stringify(snapshotDocument(document)),
          ],
        );

        await tx.unsafe(
          'UPDATE "KnowledgeDocument" SET "status"=\'ARCHIVED\'::"KnowledgeDocumentStatus","updatedAt"=now() WHERE "id"=$1',
          [document.id],
        );
      } else {
        throw new Error("Azione Knowledge non valida.");
      }

      await tx.unsafe(
        "UPDATE gemma.knowledge_proposal SET applied_at=now(),apply_error=NULL,apply_claimed_at=NULL,updated_at=now() WHERE id=$1",
        [proposal.id],
      );
    });
    return true;
  } catch (error) {
    await sql.unsafe(
      "UPDATE gemma.knowledge_proposal SET apply_error=$2,apply_claimed_at=NULL,updated_at=now() WHERE id=$1",
      [
        proposal.id,
        String(error instanceof Error ? error.message : error).slice(0, 1000),
      ],
    );
    return false;
  }
}

export async function startKnowledgeApply(jobId, proposalIds, actor) {
  await ensureSyncSchema();
  const sql = db();
  const ids = Array.isArray(proposalIds)
    ? [...new Set(proposalIds.map(String).filter(Boolean))]
    : [];

  if (!ids.length) throw new Error("Seleziona almeno una proposta.");

  await sql.begin("read write", async (tx) => {
    const jobs = await tx.unsafe(
      "SELECT status,ingest_revision FROM gemma.knowledge_sync_job WHERE id=$1 FOR UPDATE",
      [jobId],
    );

    if (!jobs[0] || jobs[0].status !== "PREVIEW_READY") {
      throw new Error(
        "La Preview non è pronta per l'Apply. Completa o riprendi prima la Preview.",
      );
    }

    if (jobs[0].ingest_revision !== KNOWLEDGE_INGEST_REVISION) {
      throw new Error(
        "La Preview è stata generata con una revisione ingest precedente. Genera una nuova Preview prima dell'Apply.",
      );
    }

    await tx.unsafe(
      "UPDATE gemma.knowledge_proposal SET selected=false,apply_claimed_at=NULL WHERE job_id=$1",
      [jobId],
    );

    for (const id of ids) {
      await tx.unsafe(
        "UPDATE gemma.knowledge_proposal SET selected=true,apply_error=NULL WHERE job_id=$1 AND id=$2",
        [jobId, id],
      );
    }

    const selected = await tx.unsafe(
      "SELECT count(*)::int AS count FROM gemma.knowledge_proposal WHERE job_id=$1 AND selected=true",
      [jobId],
    );

    if (Number(selected[0]?.count || 0) !== ids.length) {
      throw new Error("Una o più proposte non appartengono alla Preview corrente.");
    }

    const unsafe = await tx.unsafe(
      "SELECT title,metadata_json FROM gemma.knowledge_proposal " +
      "WHERE job_id=$1 AND selected=true " +
      "AND (" +
        "coalesce(metadata_json->>'safetyStatus','REVIEW') <> 'SAFE' " +
        "OR coalesce(metadata_json->>'ingestRevision','') <> $2" +
      ") LIMIT 1",
      [jobId, KNOWLEDGE_INGEST_REVISION],
    );

    if (unsafe[0]) {
      throw new Error(
        "La selezione contiene una proposta che richiede revisione manuale: " +
          unsafe[0].title,
      );
    }

    await tx.unsafe(
      "UPDATE gemma.knowledge_sync_job SET status='APPLYING',phase='APPLY'," +
      "created_by=$2,completed_at=NULL,updated_at=now() WHERE id=$1",
      [jobId, String(actor || "Admin").slice(0, 120)],
    );
  });

  return await getKnowledgeSyncJob(jobId);
}

export async function stepKnowledgeApply(jobId, batchSize = 8) {
  await ensureSyncSchema();
  const sql = db();
  const safeBatch = Math.max(1, Math.min(20, Number(batchSize) || 8));

  await sql.unsafe(
    "UPDATE gemma.knowledge_proposal SET apply_claimed_at=NULL " +
    "WHERE job_id=$1 AND applied_at IS NULL AND apply_error IS NULL " +
    "AND apply_claimed_at < now() - interval '2 minutes'",
    [jobId],
  );

  const proposals = await sql.begin("read write", async (tx) => {
    return await tx.unsafe(
      "WITH picked AS (" +
      "SELECT id FROM gemma.knowledge_proposal " +
      "WHERE job_id=$1 AND selected=true AND applied_at IS NULL " +
      "AND apply_error IS NULL AND apply_claimed_at IS NULL " +
      "ORDER BY created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED" +
      ") UPDATE gemma.knowledge_proposal p SET apply_claimed_at=now(),updated_at=now() " +
      "FROM picked WHERE p.id=picked.id RETURNING p.*",
      [jobId, safeBatch],
    );
  });

  for (const proposal of proposals) {
    await applyOneProposal(jobId, proposal);
  }

  const remaining = await sql.unsafe(
    "SELECT " +
    "count(*) FILTER (WHERE selected=true AND applied_at IS NULL AND apply_error IS NULL)::int AS pending," +
    "count(*) FILTER (WHERE selected=true AND apply_error IS NOT NULL)::int AS failed " +
    "FROM gemma.knowledge_proposal WHERE job_id=$1",
    [jobId],
  );

  if (Number(remaining[0]?.pending || 0) === 0) {
    const failed = Number(remaining[0]?.failed || 0);
    await sql.unsafe(
      "UPDATE gemma.knowledge_sync_job SET status=$2,phase='APPLY'," +
      "errors=errors+$3,completed_at=now(),updated_at=now() WHERE id=$1",
      [jobId, failed ? "APPLY_PARTIAL" : "APPLIED", failed],
    );
  }

  return await getKnowledgeSyncJob(jobId);
}

async function restoreSnapshot(snapshot) {
  const sql = db();

  await sql.begin("read write", async (tx) => {
    if (snapshot.kind === "CREATED") {
      if (snapshot.document_id) {
        await tx.unsafe(
          'DELETE FROM "KnowledgeDocument" WHERE "id"=$1',
          [snapshot.document_id],
        );
      }
    } else {
      const document = snapshot.snapshot_json;
      if (!document?.id) throw new Error("Snapshot Knowledge non valido.");

      await tx.unsafe(
        'DELETE FROM "KnowledgeChunk" WHERE "documentId"=$1',
        [document.id],
      );

      await tx.unsafe(
        'UPDATE "KnowledgeDocument" SET ' +
        '"title"=$2,"description"=$3,"category"=$4::"KnowledgeCategory",' +
        '"department"=$5::"Department","customerType"=$6,"serviceType"=$7,' +
        '"assistanceArea"=$8,"topic"=$9,"status"=$10::"KnowledgeDocumentStatus",' +
        '"version"=$11,"tags"=$12,"sourceType"=$13,"usageHints"=$14,' +
        '"deviceScope"=$15,"fileId"=$16,"fileName"=$17,"fileSize"=$18,' +
        '"fileType"=$19,"fileUrl"=$20,"updatedAt"=now() WHERE "id"=$1',
        [
          document.id,
          document.title,
          document.description,
          document.category,
          document.department,
          document.customerType,
          document.serviceType,
          document.assistanceArea,
          document.topic,
          document.status,
          document.version,
          document.tags,
          document.sourceType,
          document.usageHints,
          document.deviceScope,
          document.fileId,
          document.fileName,
          document.fileSize,
          document.fileType,
          document.fileUrl,
        ],
      );

      for (const chunk of document.chunks || []) {
        await tx.unsafe(
          'INSERT INTO "KnowledgeChunk" ("id","content","order","createdAt","documentId") ' +
          "VALUES ($1,$2,$3,now(),$4)",
          [chunk.id || randomUUID(), chunk.content, chunk.order, document.id],
        );
      }
    }

    await tx.unsafe(
      "UPDATE gemma.knowledge_snapshot SET restored_at=now(),restore_claimed_at=NULL WHERE id=$1",
      [snapshot.id],
    );
  });
}

export async function stepKnowledgeRollback(jobId, batchSize = 8) {
  await ensureSyncSchema();
  const sql = db();

  await sql.unsafe(
    "UPDATE gemma.knowledge_sync_job SET status='ROLLING_BACK',phase='ROLLBACK'," +
    "completed_at=NULL,updated_at=now() WHERE id=$1 AND status<>'ROLLED_BACK'",
    [jobId],
  );

  const safeBatch = Math.max(1, Math.min(20, Number(batchSize) || 8));

  await sql.unsafe(
    "UPDATE gemma.knowledge_snapshot SET restore_claimed_at=NULL " +
    "WHERE job_id=$1 AND restored_at IS NULL " +
    "AND restore_claimed_at < now() - interval '2 minutes'",
    [jobId],
  );

  const snapshots = await sql.begin("read write", async (tx) => {
    return await tx.unsafe(
      "WITH picked AS (" +
      "SELECT id FROM gemma.knowledge_snapshot " +
      "WHERE job_id=$1 AND restored_at IS NULL AND restore_claimed_at IS NULL " +
      "ORDER BY created_at DESC LIMIT $2 FOR UPDATE SKIP LOCKED" +
      ") UPDATE gemma.knowledge_snapshot s SET restore_claimed_at=now() " +
      "FROM picked WHERE s.id=picked.id RETURNING s.*",
      [jobId, safeBatch],
    );
  });

  for (const snapshot of snapshots) {
    await restoreSnapshot(snapshot);
  }

  const remaining = await sql.unsafe(
    "SELECT count(*)::int AS count FROM gemma.knowledge_snapshot WHERE job_id=$1 AND restored_at IS NULL",
    [jobId],
  );

  if (Number(remaining[0]?.count || 0) === 0) {
    await sql.unsafe(
      "UPDATE gemma.knowledge_sync_job SET status='ROLLED_BACK',phase='ROLLBACK'," +
      "completed_at=now(),updated_at=now() WHERE id=$1",
      [jobId],
    );
  }

  return await getKnowledgeSyncJob(jobId);
}

export async function listRecentKnowledgeJobs(limit = 8) {
  await ensureSyncSchema();
  return await db().unsafe(
    "SELECT id,status,phase,created_by,processed,discovered,proposals,errors," +
    "error_message,created_at,updated_at,completed_at " +
    "FROM gemma.knowledge_sync_job ORDER BY created_at DESC LIMIT $1",
    [Math.max(1, Math.min(20, Number(limit) || 8))],
  );
}
