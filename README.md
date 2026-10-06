# Gemma

Gemma è la preview sperimentale TAAP progettata da zero a partire dall'audit di Lia.

## Principi

- un unico modello interpreta semanticamente il turno;
- il codice recupera le fonti e applica soltanto vincoli tecnici;
- nessun classificatore linguistico a regex decide cosa intende il cliente;
- il troubleshooting procede un passo alla volta;
- un chiarimento viene risposto prima di riprendere il punto rimasto in sospeso;
- la ricerca pesa maggiormente la richiesta attuale, ma usa anche il contesto recente;
- i chunk adiacenti al risultato vengono inclusi per preservare tabelle e procedure;
- tutte le query sul DB condiviso sono eseguite dentro transazioni PostgreSQL `READ ONLY`;
- nessuna migrazione, ticket o conversazione viene scritta nel database Lia/Alda;
- la conversazione della preview viene conservata soltanto nel browser;
- il GLB di Alda viene copiato durante la build e trasformato in un asset Gemma biondo;
- avatar inquadrato testa + spalle come Alda;
- risposta testuale in streaming;
- una sola chiamata AI conversazionale per turno.

## Branch e deployment

Lo sviluppo sperimentale vive sul branch `gemma-preview` ed è distribuito esclusivamente sulla Preview Vercel di Gemma.

## Verifica

`npm test` controlla i guardrail architetturali essenziali.
`npm run build` prepara il GLB di Gemma e verifica il build Next.js.
