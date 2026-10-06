import * as cheerio from "cheerio";
import { createHash, randomUUID } from "node:crypto";
import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";

const SOURCES = [
  {
    name: "Tiscali Assistenza",
    root: "https://assistenza.tiscali.it/",
    maxPages: 1000,
    seeds: [
      "https://assistenza.tiscali.it/mobile/",
      "https://assistenza.tiscali.it/mobile/guida/configurazione-servizi/",
    ],
  },
  {
    name: "Tiscali Casa",
    root: "https://casa.tiscali.it/",
    maxPages: 100,
    seeds: [],
  },
  {
    name: "Tiscali Business",
    root: "https://business.tiscali.it/partitaiva/",
    maxPages: 100,
    seeds: [],
  },
];

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

const NON_HTML_EXTENSIONS = /\.(?:pdf|zip|rar|7z|jpg|jpeg|png|gif|webp|svg|ico|mp3|wav|ogg|mp4|mov|avi|mkv|doc|docx|xls|xlsx|ppt|pptx)$/i;
const MIN_CONTENT_LENGTH = 80;
const CHUNK_SIZE = 1200;
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

function normalizeUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (NON_HTML_EXTENSIONS.test(url.pathname)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
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

function virtualFileName(urlValue) {
  try {
    const pathname = new URL(urlValue).pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 220);
    return (pathname || "index") + ".html";
  } catch {
    return "knowledge-page.html";
  }
}

function documentMetadata(source, urlValue) {
  let serviceType = null;
  try {
    const path = new URL(urlValue).pathname.toLowerCase();
    if (path.includes("/mobile/")) serviceType = "MOBILE";
    else if (
      path.includes("/internet-telefono/") ||
      path.includes("/fibra") ||
      path.includes("/adsl")
    ) {
      serviceType = "FIXED_NETWORK";
    } else if (
      path.includes("tiscali-mail") ||
      path.includes("/email") ||
      path.includes("/posta")
    ) {
      serviceType = "EMAIL";
    } else if (path.includes("hosting") || path.includes("domini")) {
      serviceType = "DOMAINS";
    }
  } catch {}

  return {
    category: source.name === "Tiscali Assistenza" ? "FAQ" : "GENERAL",
    serviceType,
    sourceType: "WEB_SYNC",
    fileName: virtualFileName(urlValue),
  };
}

function structuredText($, root) {
  const lines = [];
  root.find("h1,h2,h3,h4,p,li,dt,dd,th,td,figcaption,blockquote").each(
    (_, element) => {
      const value = clean($(element).text(), 10000);
      if (!value) return;
      if (lines.at(-1) !== value) lines.push(value);
    },
  );

  const text = clean(lines.join("\n\n"));
  return text.length >= MIN_CONTENT_LENGTH ? text : clean(root.text());
}

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,nav,footer,header,form,button").remove();

  const title = clean(
    $("h1").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      $("title").first().text(),
    500,
  ).replace(/\s*[|–—-]\s*Tiscali.*$/i, "");

  const description = clean(
    $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content"),
    2000,
  );

  const selectors = [
    "main",
    "article",
    "[role='main']",
    "#content",
    ".page-content",
    ".entry-content",
    ".article-content",
    ".content",
  ];

  let content = "";
  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element.length) continue;
    const candidate = structuredText($, element);
    if (candidate.length > content.length) content = candidate;
    if (candidate.length >= MIN_CONTENT_LENGTH) break;
  }

  if (content.length < MIN_CONTENT_LENGTH) {
    content = structuredText($, $("body"));
  }

  const links = [];
  $("a[href]").each((_, element) => {
    const normalized = normalizeUrl($(element).attr("href"), pageUrl);
    if (normalized) links.push(normalized);
  });

  return {
    title: title || pageUrl,
    description: description || null,
    content: clean(content),
    links: [...new Set(links)],
  };
}

function splitText(value, maxLength = CHUNK_SIZE) {
  const paragraphs = clean(value)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      flush();
      let remaining = paragraph;
      while (remaining.length > maxLength) {
        let cut = remaining.lastIndexOf(" ", maxLength);
        if (cut < Math.floor(maxLength * 0.55)) cut = maxLength;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) buffer = remaining;
      continue;
    }

    const next = buffer ? buffer + "\n\n" + paragraph : paragraph;
    if (next.length > maxLength) {
      flush();
      buffer = paragraph;
    } else {
      buffer = next;
    }
  }

  flush();
  return chunks.filter(Boolean);
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

async function ensureSyncSchema() {
  await ensureGemmaSchema();

  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = db();

      await sql.unsafe(
        "CREATE TABLE IF NOT EXISTS gemma.knowledge_sync_job (" +
          "id TEXT PRIMARY KEY," +
          "status TEXT NOT NULL," +
          "phase TEXT NOT NULL," +
          "created_by TEXT NOT NULL," +
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
          "created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
          "UNIQUE(job_id,proposal_id)" +
        ")",
      );
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function existingKnowledgeForUrl(sql, urlValue, fileName) {
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
    'WHERE d."fileUrl"=$1 OR (d."sourceType"=\'WEB_SYNC\' AND d."fileName"=$2) ' +
    'ORDER BY CASE WHEN d."fileUrl"=$1 THEN 0 ELSE 1 END,d."updatedAt" DESC LIMIT 1',
    [urlValue, fileName],
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
        "Le archiviazioni rilevate dal crawler Gemma richiedono conferma manuale.",
    };
  }

  if (action === "CREATE") {
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
    reason: "Aggiornamento compatibile con il documento WEB_SYNC esistente.",
  };
}

async function saveProposal(input) {
  const { jobId, source, url, page, actionOverride } = input;
  const sql = db();
  const metadata = documentMetadata(source, url);
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
      safetyStatus: safety.status,
      safetyReason: safety.reason,
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

  if (!page || page.content.length < MIN_CONTENT_LENGTH) return null;

  const nextHash = corpusHash(page);
  const currentHash = existing
    ? corpusHash({
        title: existing.title,
        description: existing.description,
        content: existing.content,
      })
    : null;

  if (existing && currentHash === nextHash) return null;

  const action = existing ? "UPDATE" : "CREATE";
  const proposalKey = action.toLowerCase() + ":" + url;
  const safety = proposalSafety(action, existing, page);
  const proposalMetadata = {
    ...metadata,
    safetyStatus: safety.status,
    safetyReason: safety.reason,
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
      page.title,
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
      "user-agent": "Mozilla/5.0 (compatible; GemmaKnowledgeSync/1.0)",
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
  const finalUrl = normalizeUrl(response.url, urlValue) || urlValue;

  if (
    /Radware Captcha Page/i.test(html) ||
    new URL(finalUrl).hostname.toLowerCase() === "validate.perfdrive.com"
  ) {
    throw new Error("Sorgente temporaneamente bloccata da Radware");
  }

  return {
    removed: false,
    finalUrl,
    page: extractPage(html, finalUrl),
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
    "(id,status,phase,created_by,created_at,updated_at) " +
    "VALUES ($1,'PREVIEWING','PREVIEW',$2,now(),now())",
    [jobId, String(createdBy || "Admin").slice(0, 120)],
  );

  for (const source of SOURCES) {
    const initial = [source.root, ...source.seeds]
      .map((value) => normalizeUrl(value, source.root))
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

      await saveProposal({
        jobId,
        source,
        url: result.finalUrl,
        page: result.page,
      });

      return {
        source,
        links: result.page.links,
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
        const metadata = proposal.metadata_json || {};
        const id = randomUUID();
        const chunks = splitText(proposal.content_text || "");
        if (!chunks.length) throw new Error("Corpus vuoto.");

        const category = metadata.category || "GENERAL";
        const serviceType = metadata.serviceType || null;
        const fileName = metadata.fileName || virtualFileName(proposal.source_url);
        const fileId = "gemma-web-" + hash(proposal.source_url).slice(0, 24);
        const fileSize = Buffer.byteLength(proposal.content_text || "", "utf8");

        await tx.unsafe(
          'INSERT INTO "KnowledgeDocument" (' +
          '"id","title","description","category","department","customerType","serviceType",' +
          '"assistanceArea","topic","status","version","tags","sourceType","usageHints",' +
          '"deviceScope","fileId","fileName","fileSize","fileType","fileUrl","createdAt","updatedAt"' +
          ') VALUES ($1,$2,$3,$4::"KnowledgeCategory",NULL,NULL,$5,NULL,NULL,' +
          '\'DRAFT\'::"KnowledgeDocumentStatus",\'1.0\',NULL,\'WEB_SYNC\',NULL,NULL,' +
          '$6,$7,$8,\'text/html\',$9,now(),now())',
          [
            id,
            proposal.title,
            proposal.description,
            category,
            serviceType,
            fileId,
            fileName,
            fileSize,
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
        const chunks = splitText(proposal.content_text || "");
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

        await tx.unsafe(
          'UPDATE "KnowledgeDocument" SET "title"=$2,"description"=$3,"fileUrl"=$4,' +
          '"fileName"=$5,"fileSize"=$6,"fileType"=\'text/html\',"updatedAt"=now() ' +
          'WHERE "id"=$1',
          [
            document.id,
            proposal.title,
            proposal.description,
            proposal.source_url,
            virtualFileName(proposal.source_url),
            Buffer.byteLength(proposal.content_text || "", "utf8"),
          ],
        );

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
      } else if (proposal.action === "ARCHIVE") {
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
      "SELECT status FROM gemma.knowledge_sync_job WHERE id=$1 FOR UPDATE",
      [jobId],
    );

    if (!jobs[0] || jobs[0].status !== "PREVIEW_READY") {
      throw new Error(
        "La Preview non è pronta per l'Apply. Completa o riprendi prima la Preview.",
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
      "AND coalesce(metadata_json->>'safetyStatus','REVIEW') <> 'SAFE' LIMIT 1",
      [jobId],
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
      "UPDATE gemma.knowledge_snapshot SET restored_at=now() WHERE id=$1",
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
  const snapshots = await sql.unsafe(
    "SELECT * FROM gemma.knowledge_snapshot WHERE job_id=$1 AND restored_at IS NULL " +
    "ORDER BY created_at DESC LIMIT $2",
    [jobId, safeBatch],
  );

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
