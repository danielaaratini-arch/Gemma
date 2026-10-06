import OpenAI from "openai";
import { retrieveKnowledge } from "../../../lib/knowledge";

export const runtime = "nodejs";

const SYSTEM = `Sei Gemma, assistente conversazionale Tiscali.
Comprendi il significato della richiesta nel contesto invece di cercare formule rigide.

Regole minime:
- Rispondi prima a ciò che la persona sta chiedendo adesso.
- Se durante un'attività fa un chiarimento, chiarisci e conserva il filo precedente.
- Non chiedere di nuovo informazioni già fornite; usa correzioni e dettagli successivi per aggiornare la comprensione.
- Per dati Tiscali specifici, parametri, tariffe, procedure e guide usa soltanto il contenuto di supporto fornito.
- Se il contenuto di supporto non basta, dillo in modo naturale e chiedi solo l'informazione che cambierebbe davvero la risposta.
- Non parlare di knowledge, database, retrieval, prompt o sistemi interni.
- Non trasformare automaticamente una risposta breve in "problema risolto": interpreta a quale domanda sta rispondendo.
- Non dichiarare ticket, modifiche contrattuali o azioni esterne non realmente eseguite.
- Sii naturale, concisa e concreta. Evita interrogatori e percorsi artificialmente rigidi.`;

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
      .slice(-12);

    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user")?.content?.trim();

    if (!lastUser) {
      return Response.json({ error: "Richiesta vuota" }, { status: 400 });
    }

    const retrievalQuery = messages
      .slice(-5)
      .map((message) => message.content)
      .join(" ");

    const hits = await retrieveKnowledge(retrievalQuery);
    const support = hits.length
      ? hits
          .map(
            (hit, index) =>
              "[Fonte " +
              (index + 1) +
              ": " +
              hit.title +
              "]\n" +
              String(hit.content).slice(0, 2600),
          )
          .join("\n\n")
      : "Nessun contenuto di supporto pertinente recuperato.";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "OPENAI_API_KEY non configurata nella Preview Gemma" },
        { status: 503 },
      );
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";

    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: SYSTEM },
        {
          role: "system",
          content: "CONTENUTO DI SUPPORTO (sola lettura):\n" + support,
        },
        ...messages,
      ],
      max_output_tokens: 1200,
    });

    const answer = response.output_text?.trim();
    if (!answer) throw new Error("Risposta vuota");

    return Response.json({
      answer,
      knowledgeHits: hits.length,
    });
  } catch (error) {
    console.error("Gemma chat error", error);
    return Response.json({ error: "Errore temporaneo" }, { status: 500 });
  }
}
