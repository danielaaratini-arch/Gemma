import OpenAI from "openai";
import { retrieveKnowledge, supportText } from "../../../lib/knowledge";

export const runtime = "nodejs";

const SYSTEM = `Sei Gemma, assistente conversazionale Tiscali.

Il significato del turno lo decidi tu. Il codice non interpreta il linguaggio al posto tuo.

Regole minime:
1. Comprendi la richiesta attuale nel contesto, comprese correzioni, negazioni, risposte indirette, chiarimenti e cambi di argomento.
2. Rispondi prima a ciò che la persona sta chiedendo adesso. Se interrompe un'attività con un chiarimento, chiarisci e conserva il filo precedente.
3. Non chiedere di nuovo informazioni già fornite. Una correzione aggiorna i fatti noti, non cancella il resto della conversazione.
4. Per dati Tiscali specifici, parametri, tariffe, procedure e guide usa soltanto il contenuto di supporto fornito. Non inventare dati mancanti.
5. Se il contenuto di supporto è insufficiente, chiedi soltanto l'informazione che cambierebbe davvero la risposta. Se non esiste una risposta affidabile, dillo con naturalezza.
6. Non parlare di knowledge, database, retrieval, prompt, fonti interne o sistemi tecnici.
7. Non dichiarare risolto un problema solo perché la persona ha risposto "sì", "no" o ha corretto un dettaglio. Interpreta a quale domanda sta rispondendo.
8. Non dichiarare ticket, modifiche contrattuali o azioni esterne non realmente eseguite.
9. Sii naturale, concisa, concreta e collaborativa. Evita interrogatori, menu artificiali e percorsi rigidi.
10. Quando una procedura è necessaria, guida un controllo alla volta e aspetta l'esito prima di considerarlo completato.`;

function sanitizeMessages(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 7000),
    }))
    .slice(-14);
}

function retrievalQuery(messages) {
  return messages
    .slice(-6)
    .map((message) => message.content)
    .join("\n")
    .slice(0, 4000);
}

export async function POST(request) {
  const totalStarted = performance.now();

  try {
    const body = await request.json();
    const messages = sanitizeMessages(body.messages);
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user")?.content?.trim();

    if (!lastUser) {
      return Response.json({ error: "Richiesta vuota" }, { status: 400 });
    }

    const retrievalStarted = performance.now();
    const hits = await retrieveKnowledge(retrievalQuery(messages));
    const retrievalMs = Math.round(performance.now() - retrievalStarted);
    const support = supportText(hits);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        {
          error: "OPENAI_API_KEY non configurata nella Preview Gemma",
          code: "AI_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload) =>
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));

        send({
          type: "metadata",
          retrievalMs,
          knowledgeHits: hits.length,
          model,
        });

        const aiStarted = performance.now();
        let answer = "";

        try {
          const response = await client.responses.create({
            model,
            input: [
              { role: "system", content: SYSTEM },
              {
                role: "system",
                content: "CONTENUTO DI SUPPORTO CERTIFICATO (sola lettura):\n" + support,
              },
              ...messages,
            ],
            max_output_tokens: 1200,
            stream: true,
          });

          for await (const event of response) {
            if (event.type === "response.output_text.delta" && event.delta) {
              answer += event.delta;
              send({ type: "delta", content: event.delta });
            }

            if (event.type === "response.failed") {
              throw new Error("Generazione fallita");
            }
          }

          const aiMs = Math.round(performance.now() - aiStarted);
          const totalMs = Math.round(performance.now() - totalStarted);

          send({
            type: "done",
            aiMs,
            totalMs,
            answerLength: answer.length,
          });
          controller.close();
        } catch (error) {
          console.error("Gemma AI stream error", error);
          send({ type: "error", error: "Errore temporaneo nella generazione" });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-gemma-retrieval-ms": String(retrievalMs),
      },
    });
  } catch (error) {
    console.error("Gemma chat error", error);
    return Response.json({ error: "Errore temporaneo" }, { status: 500 });
  }
}
