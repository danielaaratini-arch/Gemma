import postgres from "postgres";

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  return postgres(url, {
    max: 2,
    idle_timeout: 10,
    connect_timeout: 8,
    prepare: false,
  });
}

export async function retrieveKnowledge(query) {
  const sql = database();
  const cleanQuery = String(query || "").trim().slice(0, 4000);
  if (!sql || !cleanQuery) return [];

  try {
    const rows = await sql`
      WITH ranked AS (
        SELECT
          c."id" AS seed_chunk_id,
          c."documentId" AS document_id,
          c."order" AS seed_order,
          ts_rank_cd(
            to_tsvector(
              'italian',
              coalesce(d."title",'') || ' ' ||
              coalesce(d."description",'') || ' ' ||
              coalesce(d."topic",'') || ' ' ||
              coalesce(d."tags",'') || ' ' ||
              c."content"
            ),
            websearch_to_tsquery('italian', ${cleanQuery})
          ) AS rank
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
        WHERE d."status" = 'ACTIVE'
          AND to_tsvector(
            'italian',
            coalesce(d."title",'') || ' ' ||
            coalesce(d."description",'') || ' ' ||
            coalesce(d."topic",'') || ' ' ||
            coalesce(d."tags",'') || ' ' ||
            c."content"
          ) @@ websearch_to_tsquery('italian', ${cleanQuery})
        ORDER BY rank DESC
        LIMIT 8
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
        ranked.rank::float AS score
      FROM ranked
      JOIN "KnowledgeDocument" d ON d."id" = ranked.document_id
      JOIN "KnowledgeChunk" neighbor
        ON neighbor."documentId" = ranked.document_id
       AND neighbor."order" BETWEEN ranked.seed_order - 1 AND ranked.seed_order + 1
      ORDER BY neighbor."id", ranked.rank DESC, neighbor."order" ASC
      LIMIT 24
    `;

    return rows
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || a.chunkOrder - b.chunkOrder)
      .slice(0, 18);
  } catch (error) {
    console.error("Gemma knowledge read failed", error);
    return [];
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export function supportText(hits) {
  if (!hits.length) return "Nessun contenuto di supporto pertinente recuperato.";

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
      .sort((a, b) => a.chunkOrder - b.chunkOrder)
      .map((item) => item.content)
      .join("\n");

    blocks.push(
      [
        "DOCUMENTO: " + first.title,
        first.topic ? "ARGOMENTO: " + first.topic : null,
        first.serviceType ? "SERVIZIO: " + first.serviceType : null,
        first.deviceScope ? "DISPOSITIVO: " + first.deviceScope : null,
        "CONTENUTO:",
        body,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return blocks.join("\n\n---\n\n").slice(0, 26000);
}
