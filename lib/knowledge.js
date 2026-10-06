import { knowledgeDb } from "./db";

function clean(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeServiceHint(value) {
  const hint = String(value || "").trim().toUpperCase();
  return hint === "MOBILE" || hint === "FIXED" ? hint : "";
}


function documentService(value) {
  const service = String(value || "").trim().toUpperCase();
  if (!service) return null;
  if (service.startsWith("MOBILE")) return "MOBILE";
  if (
    service.startsWith("FIXED") ||
    service === "FIBRA" ||
    service === "ADSL"
  ) {
    return "FIXED";
  }
  if (service === "EMAIL" || service.startsWith("EMAIL_")) return "EMAIL";
  if (service === "PEC" || service.startsWith("PEC_")) return "PEC";
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
    .map((hit) => documentService(hit.serviceType))
    .filter(Boolean);

  if (!services.length) return null;

  const unique = [...new Set(services)];
  return unique.length === 1 ? unique[0] : null;
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
    };
  }

  try {
    return await sql.begin("read only", async (tx) => {
      // Probe only the current user turn, without the old case context.
      // This prevents an old Mobile/Fixed state from trapping retrieval
      // when the customer has actually changed topic.
      const currentTurnHits = await queryKnowledge(tx, {
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
        switchedService === "MOBILE" || switchedService === "FIXED"
          ? switchedService
          : normalizedHint;

      if (effectiveHint) {
        const scopedHits = await queryKnowledge(tx, {
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

      const hits = await queryKnowledge(tx, {
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
  } catch (error) {
    console.error("Gemma knowledge read failed", error);
    return {
      hits: [],
      mode: "error",
      serviceHint: normalizedHint || null,
      currentTurnService: null,
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
