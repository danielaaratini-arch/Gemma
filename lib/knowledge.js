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
  if (!sql || !query.trim()) return [];

  try {
    return await sql`
      SELECT
        d."title"::text AS title,
        d."category"::text AS category,
        d."topic"::text AS topic,
        c."content"::text AS content
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
        ) @@ websearch_to_tsquery('italian', ${query})
      ORDER BY ts_rank_cd(
        to_tsvector(
          'italian',
          coalesce(d."title",'') || ' ' ||
          coalesce(d."description",'') || ' ' ||
          coalesce(d."topic",'') || ' ' ||
          coalesce(d."tags",'') || ' ' ||
          c."content"
        ),
        websearch_to_tsquery('italian', ${query})
      ) DESC,
      c."order" ASC
      LIMIT 12
    `;
  } catch (error) {
    console.error("Gemma knowledge read failed", error);
    return [];
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
