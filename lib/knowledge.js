import { knowledgeDb } from "./db";

function clean(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function retrieveKnowledge({ current, context }) {
  const sql = knowledgeDb();
  const currentQuery = clean(current);
  const contextQuery = clean(context);

  if (!sql || !currentQuery) return [];

  try {
    return await sql.begin("read only", async (tx) => {
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
    });
  } catch (error) {
    console.error("Gemma knowledge read failed", error);
    return [];
  }
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
