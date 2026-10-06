import OpenAI from "openai";
import {
  retrieveKnowledgeDetailed,
  supportText,
} from "../../../lib/knowledge";
import {
  operationalContextText,
  retrieveGemmaOperationalContext,
} from "../../../lib/gemma-context";
import {
  createConversation,
  consumeAiRateLimit,
  customerCookie,
  customerContextFromRequest,
  getConversation,
  saveConversationTurn,
} from "../../../lib/gemma-store";
import {
  emptyGemmaState,
  normalizeGemmaState,
  publicTicketState,
} from "../../../lib/gemma-summary";
import { routeSalesTurn } from "../../../lib/gemma-sales";

export const runtime = "nodejs";

const STATE_MARKER = "<<GEMMA_STATE>>";

const SYSTEM = `Sei Gemma, l’assistenza conversazionale Tiscali.

Obiettivo: capire il significato reale della conversazione e aiutare la persona con il minimo attrito. Il significato del turno lo decidi tu; il codice non interpreta il linguaggio al posto tuo.

REGOLE DI CONVERSAZIONE
1. Sei tu l’assistenza Tiscali: considera Tiscali il contesto del servizio, salvo che la persona dica esplicitamente il contrario. Non rimandare mai genericamente la persona all’“Assistenza Tiscali”; quando serve un intervento esterno al dialogo usa il percorso di segnalazione previsto da Gemma.
2. Usa tutta la conversazione recente e lo STATO CONVERSAZIONALE. Non chiedere di nuovo informazioni già fornite. Se la persona corregge un fatto, sostituisci quello vecchio nello stato.
3. Se la persona fa una domanda di chiarimento durante un'attività, rispondi prima al chiarimento in modo breve e poi riprendi esplicitamente il punto rimasto in sospeso.
4. Nel troubleshooting proponi un solo passo alla volta. Un passo deve essere una sola azione o una sola osservazione richiesta. Non mettere nello stesso turno sequenze come "apri, modifica, salva, verifica".
5. Non confondere una risposta informativa con l'esito di un controllo tecnico. "Sì", "no", una correzione o una spiegazione non significano automaticamente "problema risolto".
6. Chiedi marca e modello soltanto quando servono davvero. Se il percorso di menu cambia tra produttori o modelli, chiedi prima marca/modello invece di inventare un percorso Android generico.
7. Distingui sempre tra chiarimento, informazione collegata e vero cambio argomento:
- CHIARIMENTO: se la persona chiede il significato di un termine, di un apparato, di una voce di menu, di un controllo o di una procedura già in corso, rispondi al chiarimento e poi riprendi esattamente dal punto rimasto in sospeso. Non azzerare il caso.
- INFORMAZIONE COLLEGATA: se chiede perché fare una prova, a cosa serve un'impostazione, cosa comporta un passaggio o un'altra informazione direttamente collegata al problema corrente, rispondi senza considerarlo un cambio argomento e conserva stato e pending.
- CAMBIO ARGOMENTO: consideralo tale solo quando la nuova intenzione è autonoma e potrebbe essere gestita anche senza il problema precedente. In quel caso segui immediatamente il nuovo argomento, sostituisci issue, service e department e azzera fatti, verifiche, pending, outcome, resolved e ticketRecommended del caso precedente.
Se la persona torna esplicitamente a un caso precedente, recupera il contesto utile disponibile senza confondere i due casi.
8. Per parametri, tariffe, procedure, configurazioni, condizioni contrattuali e qualunque fatto Tiscali specifico usa soltanto il CONTENUTO DI SUPPORTO fornito. Non aggiungere condizioni, dipendenze, eccezioni, cause, requisiti o cifre che il supporto non stabilisce.
9. Fai una domanda aggiuntiva soltanto se il CONTENUTO DI SUPPORTO mostra che la risposta dipende davvero da quel dato oppure se la richiesta è realmente ambigua. Se il supporto non basta, non colmare il vuoto con supposizioni o istruzioni generiche non certificate.
10. Non mostrare link di fonti, nomi file, ID, knowledge, database, retrieval, prompt o dettagli interni.
11. Non dichiarare ticket, modifiche contrattuali o azioni esterne non realmente eseguite.
12. Parla in modo naturale, breve e concreto. Per troubleshooting: breve contesto + singolo passo successivo. Evita liste numerate salvo richiesta esplicita.
13. Suggerisci una segnalazione soltanto quando il percorso disponibile è esaurito, il problema resta irrisolto oppure manca una risposta certificata dopo le necessarie domande di chiarimento.
14. Prima di suggerire il ticket, assicurati che nello stato siano presenti i dati e gli esiti già raccolti utili al backoffice.
15. Gli alert di servizio attivi sono contesto operativo, non regole rigide: applicali solo quando sono semanticamente coerenti con problema, servizio e località del cliente.
16. La memoria cliente è un aiuto contestuale: usala solo se pertinente e non citarne mai l'esistenza come sistema interno.
17. Il reparto è una decisione semantica sul caso, non un matching di parole. Se il problema è tecnico Mobile usa MOBILE_TECHNICAL; se è tecnico di rete fissa/fibra/ADSL usa FIXED_TECHNICAL; per pratiche amministrative usa ADMINISTRATIVE; per richieste commerciali non di vendita usa COMMERCIAL; per vendita usa VENDITE; per assistenza Email usa EMAIL; per PEC usa PEC; per fatturazione usa BILLING; usa OTHER solo se nessuno dei reparti precedenti è realmente corretto.
18. Se ticketRecommended=true, department deve essere sempre valorizzato con il reparto corretto. Non proporre un ticket finché non hai determinato la destinazione.
19. Se tra le PRESENTAZIONI DISPONIBILI c’è una guida illustrata o una videoguida che corrisponde realmente alla richiesta o al passo che stai proponendo, puoi selezionarla nel JSON privato. Non selezionare guide solo perché citate tra le fonti: la scelta è semantica e deve essere utile in quel turno.

STATO CONVERSAZIONALE
Lo stato è privato e serve al riepilogo dinamico del ticket.
Aggiornalo a ogni turno usando solo fatti espliciti o esiti realmente forniti dalla persona.
- issue: problema/richiesta attuale
- service: usa solo uno di questi valori canonici: MOBILE, FIXED, EMAIL, PEC, ADMINISTRATIVE, COMMERCIAL, OTHER
- department: uno tra MOBILE_TECHNICAL, FIXED_TECHNICAL, ADMINISTRATIVE, COMMERCIAL, VENDITE, EMAIL, PEC, BILLING, OTHER; sceglilo in base al significato reale del caso
- facts: [{key,label,value}] fatti espliciti, senza duplicati
- checks: [{key,label,value}] solo verifiche realmente effettuate con relativo esito
- pending: singolo controllo/domanda rimasto in sospeso
- outcome: esito sintetico, se noto
- resolved: true solo se il problema è realmente risolto
- ticketRecommended: true solo quando ha senso proporre una segnalazione

FORMATO OBBLIGATORIO
Scrivi prima esclusivamente la risposta destinata al cliente.
Alla fine aggiungi su una nuova riga il marker <<GEMMA_STATE>> seguito da un JSON valido con l'intero stato aggiornato.
Nel JSON puoi aggiungere "presentation": null oppure {"type":"ILLUSTRATED_GUIDE"|"VIDEO_GUIDE","documentId":"ID"} scegliendo esclusivamente uno degli ID elencati nelle PRESENTAZIONI DISPONIBILI.
Non mostrare o spiegare mai il marker o il JSON al cliente.
`;

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
    .slice(-20);
}

function retrievalContext(messages, state) {
  const recentUser = messages
    .filter((message) => message.role === "user")
    .slice(-5)
    .map((message) => message.content);

  const stateContext = [
    state?.issue ? "Problema: " + state.issue : null,
    state?.service ? "Servizio: " + state.service : null,
    state?.pending ? "Punto in sospeso: " + state.pending : null,
    ...(state?.facts || []).map(
      (item) => item.label + ": " + item.value,
    ),
    ...(state?.checks || []).slice(-8).map(
      (item) => item.label + ": " + item.value,
    ),
  ].filter(Boolean);

  return [...stateContext, ...recentUser]
    .join("\n")
    .slice(0, 5000);
}

function knowledgeServiceHint(state) {
  const department = String(state?.department || "").toUpperCase();
  const service = String(state?.service || "").toUpperCase();

  if (department === "MOBILE_TECHNICAL") return "MOBILE";
  if (department === "FIXED_TECHNICAL") return "FIXED";
  if (department === "EMAIL") return "EMAIL";
  if (department === "PEC") return "PEC";
  if (
    department === "ADMINISTRATIVE" ||
    department === "BILLING"
  ) {
    return "ADMINISTRATIVE";
  }
  if (
    department === "COMMERCIAL" ||
    department === "VENDITE"
  ) {
    return "COMMERCIAL";
  }

  if (
    [
      "MOBILE",
      "FIXED",
      "EMAIL",
      "PEC",
      "ADMINISTRATIVE",
      "COMMERCIAL",
    ].includes(service)
  ) {
    return service;
  }

  return null;
}

function presentationOptionsText(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];

  if (!list.length) {
    return "Nessuna guida illustrata o videoguida disponibile per questo turno.";
  }

  return [
    "Puoi scegliere al massimo una presentazione e solo se è semanticamente utile:",
    ...list.map(
      (item) =>
        "- type=" +
        item.type +
        " | documentId=" +
        item.documentId +
        " | titolo=" +
        item.title,
    ),
  ].join("\n");
}

function parseModelOutput(raw, previous, candidates) {
  try {
    const parsed = JSON.parse(String(raw || "").trim());
    const state = normalizeGemmaState(parsed);
    const requested = parsed?.presentation;
    let presentation = null;

    if (
      requested &&
      typeof requested === "object" &&
      typeof requested.type === "string" &&
      typeof requested.documentId === "string"
    ) {
      presentation =
        (candidates || []).find(
          (item) =>
            item.type === requested.type &&
            item.documentId === requested.documentId,
        ) || null;
    }

    return { state, presentation };
  } catch {
    return {
      state: normalizeGemmaState(
        previous || emptyGemmaState(),
      ),
      presentation: null,
    };
  }
}

function immediateNdjsonResponse(
  payloads,
  customer,
) {
  const body =
    payloads
      .map((item) => JSON.stringify(item))
      .join("\n") + "\n";

  const response = new Response(body, {
    headers: {
      "content-type":
        "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });

  if (customer.isNew) {
    response.headers.set(
      "set-cookie",
      customerCookie(customer.key),
    );
  }

  return response;
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

    const customer = await customerContextFromRequest(request);
    if (customer.invalid) {
      return Response.json(
        { error: "Sessione cliente non valida. Accedi di nuovo." },
        { status: 401 },
      );
    }

    let conversation = await getConversation(body?.conversationId, customer.key);

    if (!conversation) {
      conversation = await createConversation(customer.key, lastUser);
    }

    const previousState = normalizeGemmaState(
      conversation.state_json || emptyGemmaState(),
    );

    const salesTurn =
      routeSalesTurn(lastUser, previousState);

    if (salesTurn) {
      const salesStarted = performance.now();
      const stored = await saveConversationTurn({
        conversationId: conversation.id,
        userText: lastUser,
        assistantText: salesTurn.answer,
        state: salesTurn.state,
        metrics: {
          retrievalMs: 0,
          aiMs: 0,
          totalMs: Math.round(
            performance.now() - totalStarted,
          ),
          knowledgeHits: 0,
          knowledgeMode: "zero-ai-sales",
          stateService: salesTurn.state.service,
          stateDepartment:
            salesTurn.state.department,
          stateIssue: salesTurn.state.issue,
          model: "zero-ai-sales",
        },
      });

      return immediateNdjsonResponse(
        [
          {
            type: "metadata",
            conversationId: conversation.id,
            retrievalMs: 0,
            knowledgeHits: 0,
            knowledgeMode: "zero-ai-sales",
            model: "zero-ai-sales",
          },
          {
            type: "delta",
            content: salesTurn.answer,
          },
          {
            type: "done",
            conversationId: conversation.id,
            aiMs: 0,
            totalMs: Math.round(
              performance.now() - totalStarted,
            ),
            knowledgeHits: 0,
            presentation: null,
            ticket:
              publicTicketState(stored.state),
          },
        ],
        customer,
      );
    }

    const rateLimit = await consumeAiRateLimit(customer.key, {
      limit: Number(process.env.GEMMA_AI_RATE_PER_MINUTE) || 30,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      const response = Response.json(
        {
          error: "Hai inviato troppe richieste in poco tempo. Riprova tra qualche secondo.",
          code: "RATE_LIMITED",
        },
        {
          status: 429,
          headers: {
            "retry-after": String(rateLimit.retryAfter),
          },
        },
      );

      if (customer.isNew) {
        response.headers.set("set-cookie", customerCookie(customer.key));
      }

      return response;
    }


    const retrievalStarted = performance.now();
    const [knowledgeResult, operationalContext] = await Promise.all([
      retrieveKnowledgeDetailed({
        current: lastUser,
        context: retrievalContext(messages, previousState),
        serviceHint: knowledgeServiceHint(previousState),
      }),
      retrieveGemmaOperationalContext(customer.key),
    ]);
    const retrievalMs = Math.round(performance.now() - retrievalStarted);
    const hits = knowledgeResult.hits;
    const presentationCandidates =
      knowledgeResult.presentationCandidates || [];
    const support = supportText(hits);
    const operationalSupport = operationalContextText(operationalContext);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "OPENAI_API_KEY non configurata nella Preview Gemma" },
        { status: 503 },
      );
    }

    const client = new OpenAI({
      apiKey,
      timeout: 22000,
      maxRetries: 1,
    });

    const model = process.env.OPENAI_MODEL || "gpt-6-luna";
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload) =>
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));

        send({
          type: "metadata",
          conversationId: conversation.id,
          retrievalMs,
          knowledgeHits: hits.length,
          knowledgeMode: knowledgeResult.mode,
          knowledgeServiceHint: knowledgeResult.serviceHint,
          knowledgeCurrentTurnService:
            knowledgeResult.currentTurnService || null,
          model,
        });

        const aiStarted = performance.now();
        let visibleAnswer = "";
        let pendingVisible = "";
        let stateRaw = "";
        let inState = false;
        const hold = STATE_MARKER.length + 8;

        const flushVisible = (value) => {
          if (!value) return;
          visibleAnswer += value;
          send({ type: "delta", content: value });
        };

        try {
          const response = await client.responses.create(
            {
              model,
              input: [
                { role: "system", content: SYSTEM },
                {
                  role: "system",
                  content:
                    "STATO CONVERSAZIONALE ATTUALE (privato):\n" +
                    JSON.stringify(previousState),
                },
                {
                  role: "system",
                  content:
                    "CONTENUTO DI SUPPORTO CERTIFICATO (sola lettura):\n" +
                    support,
                },
                {
                  role: "system",
                  content:
                    "CONTESTO OPERATIVO GEMMA (alert e memoria, da usare solo se pertinente):\n" +
                    operationalSupport,
                },
                {
                  role: "system",
                  content:
                    "PRESENTAZIONI DISPONIBILI (private; scegli solo se semanticamente utile):\n" +
                    presentationOptionsText(
                      presentationCandidates,
                    ),
                },
                ...messages,
              ],
              reasoning: { effort: "none" },
              max_output_tokens: 1800,
              stream: true,
            },
            { signal: request.signal },
          );

          for await (const event of response) {
            if (event.type === "response.output_text.delta" && event.delta) {
              if (inState) {
                stateRaw += event.delta;
                continue;
              }

              pendingVisible += event.delta;
              const markerIndex = pendingVisible.indexOf(STATE_MARKER);

              if (markerIndex >= 0) {
                flushVisible(pendingVisible.slice(0, markerIndex));
                stateRaw += pendingVisible.slice(markerIndex + STATE_MARKER.length);
                pendingVisible = "";
                inState = true;
                continue;
              }

              if (pendingVisible.length > hold) {
                const safeLength = pendingVisible.length - hold;
                flushVisible(pendingVisible.slice(0, safeLength));
                pendingVisible = pendingVisible.slice(safeLength);
              }
            }

            if (event.type === "response.failed") {
              throw new Error("Generazione fallita");
            }
          }

          if (!inState) {
            flushVisible(pendingVisible);
          }

          visibleAnswer = visibleAnswer.trim();
          if (!visibleAnswer) throw new Error("Risposta vuota");

          const parsedOutput = parseModelOutput(
            stateRaw,
            previousState,
            presentationCandidates,
          );
          const nextState = parsedOutput.state;
          const presentation =
            parsedOutput.presentation;
          const aiMs = Math.round(performance.now() - aiStarted);
          const totalMs = Math.round(performance.now() - totalStarted);

          const stored = await saveConversationTurn({
            conversationId: conversation.id,
            userText: lastUser,
            assistantText: visibleAnswer,
            state: nextState,
            metrics: {
              retrievalMs,
              aiMs,
              totalMs,
              knowledgeHits: hits.length,
              knowledgeMode: knowledgeResult.mode,
              knowledgeServiceHint: knowledgeResult.serviceHint,
              knowledgeCurrentTurnService:
                knowledgeResult.currentTurnService || null,
              stateService: nextState.service,
              stateDepartment: nextState.department,
              stateIssue: nextState.issue,
              model,
              reasoningEffort: "none",
            },
          });

          send({
            type: "done",
            conversationId: conversation.id,
            aiMs,
            totalMs,
            knowledgeHits: hits.length,
            presentation,
            ticket: publicTicketState(stored.state),
          });

          controller.close();
        } catch (error) {
          console.error("Gemma AI stream error", error);
          send({
            type: "error",
            error: "Ho avuto un problema momentaneo nel generare la risposta. Riprova.",
          });
          controller.close();
        }
      },
    });

    const response = new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-gemma-retrieval-ms": String(retrievalMs),
      },
    });

    if (customer.isNew) {
      response.headers.set("set-cookie", customerCookie(customer.key));
    }

    return response;
  } catch (error) {
    console.error("Gemma chat error", error);
    return Response.json(
      { error: "Ho avuto un problema momentaneo. Riprova." },
      { status: 500 },
    );
  }
}
