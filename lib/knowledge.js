import { knowledgeDb } from "./db";

function clean(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeServiceHint(value) {
  const hint = String(value || "").trim().toUpperCase();
  return [
    "MOBILE",
    "FIXED",
    "EMAIL",
    "PEC",
    "ADMINISTRATIVE",
    "COMMERCIAL",
  ].includes(hint)
    ? hint
    : "";
}


function documentService(serviceValue, areaValue, topicValue, titleValue) {
  const service = String(serviceValue || "").trim().toUpperCase();
  const area = String(areaValue || "").trim().toUpperCase();
  const topic = String(topicValue || "").trim().toUpperCase();
  const title = String(titleValue || "").trim().toUpperCase();

  if (service.startsWith("MOBILE") || area.startsWith("MOBILE")) {
    return "MOBILE";
  }

  if (
    service.startsWith("FIXED") ||
    service === "FIBRA" ||
    service === "ADSL"
  ) {
    return "FIXED";
  }

  if (
    service.includes("PEC") ||
    area.includes("PEC") ||
    topic.includes("PEC") ||
    /\bPEC\b/.test(title)
  ) {
    return "PEC";
  }

  if (service.startsWith("EMAIL") || area.startsWith("EMAIL")) {
    return "EMAIL";
  }

  if (
    service === "ADMINISTRATIVE" ||
    area === "ADMINISTRATIVE" ||
    area === "BILLING"
  ) {
    return "ADMINISTRATIVE";
  }

  if (
    service === "COMMERCIAL" ||
    area === "COMMERCIAL" ||
    area === "VENDITE"
  ) {
    return "COMMERCIAL";
  }

  return null;
}

function inferCurrentTurnService(hits) {
  const byDocument = new Map();

  for (const hit of hits || []) {
    if (!byDocument.has(hit.documentId)) {
      byDocument.set(hit.documentId, hit);
    }
  }

  const services = [...byDocument.values()]
    .slice(0, 6)
    .map((hit) =>
      documentService(
        hit.serviceType,
        hit.assistanceArea,
        hit.topic,
        hit.title,
      ),
    )
    .filter(Boolean);

  if (!services.length) return null;

  const unique = [...new Set(services)];
  return unique.length === 1 ? unique[0] : null;
}


function relaxedSearchQuery(value, maxTerms = 14) {
  const stopWords = new Set([
    "che", "chi", "come", "cosa", "con", "dal", "dalla", "dalle",
    "dello", "della", "delle", "degli", "dei", "del", "di", "da",
    "e", "ed", "gli", "hai", "ho", "il", "in", "io", "la", "le",
    "lo", "mi", "ne", "nel", "nella", "nelle", "non", "per", "piu",
    "puo", "quanto", "quale", "quali", "se", "si", "sono", "su",
    "sul", "sulla", "tra", "un", "una", "uno", "tiscali", "gemma"
  ]);

  const normalized = clean(value, 5000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT");

  const terms = normalized.match(/[a-z0-9]+/g) || [];
  const unique = [];

  for (const term of terms) {
    if (
      term.length < 3 ||
      stopWords.has(term) ||
      unique.includes(term)
    ) {
      continue;
    }

    unique.push(term);
    if (unique.length >= maxTerms) break;
  }

  return unique.join(" OR ");
}

function mergeKnowledgeHits(primary, secondary, max = 21) {
  const seen = new Set();
  const merged = [];

  for (const hit of [...(primary || []), ...(secondary || [])]) {
    const key = String(hit?.chunkId || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
    if (merged.length >= max) break;
  }

  return merged;
}

async function queryKnowledgeRobust(
  tx,
  { currentQuery, contextQuery, serviceHint },
) {
  const exact = await queryKnowledge(tx, {
    currentQuery,
    contextQuery,
    serviceHint,
  });

  const relaxedCurrent = relaxedSearchQuery(currentQuery);
  const relaxedContext = relaxedSearchQuery(contextQuery, 18);

  if (!relaxedCurrent) return exact;

  const relaxed = await queryKnowledge(tx, {
    currentQuery: relaxedCurrent,
    contextQuery: relaxedContext,
    serviceHint,
  });

  return mergeKnowledgeHits(exact, relaxed);
}

function presentationCandidatesFromHits(hits) {
  const seen = new Set();
  const candidates = [];

  for (const hit of hits || []) {
    const documentId = String(hit?.documentId || "").trim();
    if (!documentId || seen.has(documentId)) continue;

    const sourceType = String(hit?.sourceType || "").toUpperCase();
    const service = documentService(
      hit?.serviceType,
      hit?.assistanceArea,
      hit?.topic,
      hit?.title,
    );

    let type = null;

    if (sourceType === "MOBILE_CONFIG") {
      type = "ILLUSTRATED_GUIDE";
    } else if (service === "FIXED" && hit?.fileUrl) {
      try {
        const url = new URL(String(hit.fileUrl));
        if (
          url.protocol === "https:" &&
          url.hostname === "assistenza.tiscali.it" &&
          url.pathname.startsWith("/internet-telefono/")
        ) {
          type = "VIDEO_GUIDE";
        }
      } catch {}
    }

    if (!type) continue;

    seen.add(documentId);
    candidates.push({
      type,
      documentId,
      title: String(hit?.title || "").trim(),
    });

    if (candidates.length >= 6) break;
  }

  return candidates;
}

async function queryKnowledge(tx, { currentQuery, contextQuery, serviceHint }) {
  const scope = normalizeServiceHint(serviceHint);

  const rows = await tx`
    WITH scored AS (
      SELECT
        c."id" AS seed_chunk_id,
        c."documentId" AS document_id,
        c."order" AS seed_order,
        (
          1.00 * ts_rank_cd(
            to_tsvector(
              'italian',
              coalesce(d."title",'') || ' ' ||
              coalesce(d."description",'') || ' ' ||
              coalesce(d."topic",'') || ' ' ||
              coalesce(d."tags",'') || ' ' ||
              c."content"
            ),
            websearch_to_tsquery('italian', ${currentQuery})
          )
          +
          CASE
            WHEN ${contextQuery} <> ''
            THEN 0.35 * ts_rank_cd(
              to_tsvector(
                'italian',
                coalesce(d."title",'') || ' ' ||
                coalesce(d."description",'') || ' ' ||
                coalesce(d."topic",'') || ' ' ||
                coalesce(d."tags",'') || ' ' ||
                c."content"
              ),
              websearch_to_tsquery('italian', ${contextQuery})
            )
            ELSE 0
          END
        ) AS rank
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      WHERE d."status" = 'ACTIVE'
        AND (
          ${scope} = ''
          OR d."serviceType" IS NULL
          OR (
            ${scope} = 'MOBILE'
            AND (
              upper(coalesce(d."serviceType",'')) LIKE 'MOBILE%'
              OR upper(coalesce(d."assistanceArea",'')) LIKE 'MOBILE%'
            )
          )
          OR (
            ${scope} = 'FIXED'
            AND (
              upper(coalesce(d."serviceType",'')) LIKE 'FIXED%'
              OR upper(coalesce(d."serviceType",'')) IN ('FIBRA','ADSL')
            )
          )
          OR (
            ${scope} = 'EMAIL'
            AND (
              upper(coalesce(d."serviceType",'')) LIKE 'EMAIL%'
              OR upper(coalesce(d."assistanceArea",'')) LIKE 'EMAIL%'
            )
          )
          OR (
            ${scope} = 'PEC'
            AND (
              upper(coalesce(d."serviceType",'')) LIKE '%PEC%'
              OR upper(coalesce(d."assistanceArea",'')) LIKE '%PEC%'
              OR upper(coalesce(d."topic",'')) LIKE '%PEC%'
              OR upper(coalesce(d."title",'')) LIKE '%PEC%'
            )
          )
          OR (
            ${scope} = 'ADMINISTRATIVE'
            AND (
              upper(coalesce(d."serviceType",'')) = 'ADMINISTRATIVE'
              OR upper(coalesce(d."assistanceArea",'')) IN ('ADMINISTRATIVE','BILLING')
            )
          )
          OR (
            ${scope} = 'COMMERCIAL'
            AND (
              upper(coalesce(d."serviceType",'')) = 'COMMERCIAL'
              OR upper(coalesce(d."assistanceArea",'')) IN ('COMMERCIAL','VENDITE')
              OR upper(coalesce(d."category"::text,'')) = 'COMMERCIAL'
            )
          )
        )
        AND (
          to_tsvector(
            'italian',
            coalesce(d."title",'') || ' ' ||
            coalesce(d."description",'') || ' ' ||
            coalesce(d."topic",'') || ' ' ||
            coalesce(d."tags",'') || ' ' ||
            c."content"
          ) @@ websearch_to_tsquery('italian', ${currentQuery})
          OR (
            ${contextQuery} <> ''
            AND to_tsvector(
              'italian',
              coalesce(d."title",'') || ' ' ||
              coalesce(d."description",'') || ' ' ||
              coalesce(d."topic",'') || ' ' ||
              coalesce(d."tags",'') || ' ' ||
              c."content"
            ) @@ websearch_to_tsquery('italian', ${contextQuery})
          )
        )
      ORDER BY rank DESC
      LIMIT 10
    )
    SELECT DISTINCT ON (neighbor."id")
      d."id"::text AS "documentId",
      d."title"::text AS title,
      d."category"::text AS category,
      d."topic"::text AS topic,
      d."serviceType"::text AS "serviceType",
      d."assistanceArea"::text AS "assistanceArea",
      d."sourceType"::text AS "sourceType",
      d."usageHints"::text AS "usageHints",
      d."deviceScope"::text AS "deviceScope",
      d."fileUrl"::text AS "fileUrl",
      neighbor."id"::text AS "chunkId",
      neighbor."order" AS "chunkOrder",
      neighbor."content"::text AS content,
      scored.rank::float AS score
    FROM scored
    JOIN "KnowledgeDocument" d ON d."id" = scored.document_id
    JOIN "KnowledgeChunk" neighbor
      ON neighbor."documentId" = scored.document_id
     AND neighbor."order" BETWEEN scored.seed_order - 1 AND scored.seed_order + 1
    ORDER BY neighbor."id", scored.rank DESC, neighbor."order" ASC
    LIMIT 30
  `;

  return rows
    .sort(
      (left, right) =>
        Number(right.score || 0) - Number(left.score || 0) ||
        Number(left.chunkOrder || 0) - Number(right.chunkOrder || 0),
    )
    .slice(0, 21);
}

export async function retrieveKnowledgeDetailed({
  current,
  context,
  serviceHint = null,
}) {
  const sql = knowledgeDb();
  const currentQuery = clean(current);
  const contextQuery = clean(context);
  const normalizedHint = normalizeServiceHint(serviceHint);

  if (!sql || !currentQuery) {
    return {
      hits: [],
      mode: normalizedHint ? "scoped-empty" : "general-empty",
      serviceHint: normalizedHint || null,
      presentationCandidates: [],
    };
  }

  try {
    const result = await sql.begin("read only", async (tx) => {
      // Probe only the current user turn, without the old case context.
      // This prevents an old Mobile/Fixed state from trapping retrieval
      // when the customer has actually changed topic.
      const currentTurnHits = await queryKnowledgeRobust(tx, {
        currentQuery,
        contextQuery: "",
        serviceHint: "",
      });
      const currentTurnService = inferCurrentTurnService(currentTurnHits);

      const switchedService =
        currentTurnService &&
        currentTurnService !== normalizedHint
          ? currentTurnService
          : null;

      const effectiveHint =
        switchedService || normalizedHint;

      if (effectiveHint) {
        const scopedHits = await queryKnowledgeRobust(tx, {
          currentQuery,
          contextQuery,
          serviceHint: effectiveHint,
        });

        if (scopedHits.length > 0) {
          return {
            hits: scopedHits,
            mode: switchedService ? "topic-switch-scoped" : "service-scoped",
            serviceHint: effectiveHint,
            currentTurnService,
          };
        }

        return {
          hits: [],
          mode: "scoped-empty",
          serviceHint: effectiveHint,
          currentTurnService,
        };
      }

      if (currentTurnHits.length > 0) {
        return {
          hits: currentTurnHits,
          mode: currentTurnService ? "topic-switch-general" : "general",
          serviceHint: currentTurnService,
          currentTurnService,
        };
      }

      const hits = await queryKnowledgeRobust(tx, {
        currentQuery,
        contextQuery,
        serviceHint: "",
      });

      return {
        hits,
        mode: hits.length ? "general-context" : "general-empty",
        serviceHint: null,
        currentTurnService: null,
      };
    });

    return {
      ...result,
      presentationCandidates: presentationCandidatesFromHits(result.hits),
    };

  } catch (error) {
    console.error("Gemma knowledge read failed", error);
    return {
      hits: [],
      mode: "error",
      serviceHint: normalizedHint || null,
      currentTurnService: null,
      presentationCandidates: [],
    };
  }
}

export async function retrieveKnowledge(input) {
  return (await retrieveKnowledgeDetailed(input)).hits;
}

export function supportText(hits) {
  if (!hits.length) {
    return "Nessun contenuto di supporto pertinente recuperato.";
  }

  const byDocument = new Map();

  for (const hit of hits) {
    const list = byDocument.get(hit.documentId) || [];
    list.push(hit);
    byDocument.set(hit.documentId, list);
  }

  const blocks = [];

  for (const list of byDocument.values()) {
    const first = list[0];
    const body = list
      .sort((a, b) => Number(a.chunkOrder) - Number(b.chunkOrder))
      .map((item) => item.content)
      .join("\n");

    blocks.push(
      [
        "DOCUMENTO: " + first.title,
        first.category ? "CATEGORIA: " + first.category : null,
        first.topic ? "ARGOMENTO: " + first.topic : null,
        first.serviceType ? "SERVIZIO: " + first.serviceType : null,
        first.assistanceArea ? "AREA: " + first.assistanceArea : null,
        first.deviceScope ? "DISPOSITIVO: " + first.deviceScope : null,
        first.usageHints ? "NOTE D'USO: " + first.usageHints : null,
        "CONTENUTO:",
        body,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return blocks.join("\n\n---\n\n").slice(0, 28000);
}
