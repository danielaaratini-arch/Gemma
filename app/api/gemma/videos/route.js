import { videoGuidesForDocument } from "../../../../lib/gemma-video";

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
        {
          error:
            "Videoguida non valida.",
        },
        { status: 400 },
      );
    }

    const guides =
      await videoGuidesForDocument(
        documentId,
      );

    return Response.json(
      { guides },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Gemma video endpoint error",
      error,
    );

    return Response.json(
      {
        error:
          "Videoguida temporaneamente non disponibile.",
      },
      { status: 500 },
    );
  }
}
