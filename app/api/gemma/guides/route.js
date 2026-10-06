import { knowledgeDb } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();

    const documentId =
      typeof body?.documentId === "string"
        ? body.documentId.trim()
        : "";

    if (
      !documentId ||
      documentId.length > 120
    ) {
      return Response.json(
        { error: "Guida non valida." },
        { status: 400 },
      );
    }

    const sql = knowledgeDb();

    if (!sql) {
      return Response.json(
        {
          error:
            "Knowledge non disponibile.",
        },
        { status: 503 },
      );
    }

    const rows = await sql.begin(
      "read only",
      (tx) =>
        tx.unsafe(
          [
            'SELECT ',
            'd."id"::text AS "documentId",',
            'd."title"::text AS title,',
            'c."id"::text AS "chunkId",',
            'c."order" AS "chunkOrder",',
            'c."content"::text AS content ',
            'FROM "KnowledgeDocument" d ',
            'JOIN "KnowledgeChunk" c ',
            'ON c."documentId" = d."id" ',
            'WHERE d."id" = $1 ',
            'AND d."status" = \'ACTIVE\' ',
            'AND d."sourceType" = \'MOBILE_CONFIG\' ',
            'ORDER BY c."order" ASC ',
            'LIMIT 80',
          ].join(""),
          [documentId],
        ),
    );

    if (!rows.length) {
      return Response.json(
        { guide: null },
        { status: 404 },
      );
    }

    return Response.json(
      {
        guide: {
          documentId,
          title: rows[0].title,
          steps: rows.map(
            (row, index) => ({
              chunkId: row.chunkId,
              order:
                Number(row.chunkOrder),
              stepNumber:
                index + 1,
              text: row.content,
            }),
          ),
        },
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Gemma guide read error",
      error,
    );

    return Response.json(
      {
        error:
          "Guida temporaneamente non disponibile.",
      },
      { status: 500 },
    );
  }
}
