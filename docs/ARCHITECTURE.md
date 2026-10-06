# Architettura Gemma

## Flusso conversazionale

```
Cliente
  ↓
messaggio corrente + stato conversazionale persistito
  ↓
probe del turno corrente
  ├─ riconoscimento cambio dominio
  └─ mantenimento del dominio quando è un chiarimento/follow-up
  ↓
retrieval Knowledge condivisa in READ ONLY
  ├─ domanda corrente
  ├─ problema / pending / fatti / verifiche
  └─ scope Mobile, Fisso, Email, PEC, Amministrativo o Commerciale
  ↓
fonti pertinenti + contesto operativo Gemma
  ↓
UNICA chiamata al modello
  ├─ risposta cliente
  └─ stato strutturato privato
  ↓
persistenza schema gemma + streaming testo + TTS
```

## Responsabilità

### Modello
Interpreta intenzione, correzioni, negazioni, chiarimenti, informazioni collegate,
cambi argomento, esiti dei controlli e reparto corretto. Non esistono regex che
decidono il significato della frase al posto del modello.

### Retrieval
Legge la Knowledge canonica condivisa da Lia, Alda e Gemma. La chat non scrive
mai sulla Knowledge. Il retrieval usa transazioni PostgreSQL READ ONLY.

### Stato conversazionale
Per ogni caso Gemma conserva problema, servizio, reparto, fatti espliciti,
verifiche realmente eseguite, punto in sospeso ed esito. Un chiarimento non
azzera il caso; un vero cambio argomento sostituisce lo stato del caso precedente.

### Ticket
Il ticket può essere proposto soltanto dopo che Gemma ha determinato il reparto.
Il riepilogo mostrato al cliente e al Backoffice deriva dallo stesso stato
strutturato della conversazione.

## Backoffice e Admin

I dati operativi di Gemma vivono esclusivamente nello schema `gemma`.

Il Backoffice gestisce code, reparto, priorità, assegnatario, messaggi,
allegati, note interne, timeline e performance.

L'Admin gestisce accessi, alert fault, Customer Memory, No Match, osservabilità,
gradimento, conversazioni, report e Knowledge.

## No Match

`NO MATCH = knowledgeHits = 0`.

I turni in cui il retrieval fallisce tecnicamente non vengono classificati come
No Match. Servizio, reparto e problema vengono salvati insieme al turno per non
essere alterati da successivi cambi argomento.

## Knowledge

La Knowledge resta unica per Lia, Alda e Gemma.

Gemma dispone di:
- vista No Match;
- integrazione e modifica manuale;
- Preview massiva;
- selezione delle proposte;
- Apply;
- snapshot e Rollback.

La Preview scrive soltanto tabelle operative nello schema `gemma`. Le
archiviazioni automatiche e gli aggiornamenti con estrazione sospetta vengono
bloccati in revisione. I nuovi documenti dal crawler vengono creati come DRAFT.

## Sicurezza operativa

Le sessioni Admin e Backoffice vengono validate contro l'account attivo nel DB,
quindi la disattivazione revoca l'accesso senza attendere la scadenza del cookie.

L'Area Cliente usa un account CUSTOMER. Al primo login/registrazione, eventuali
ticket creati nella sessione anonima vengono associati all'account.

In production lo schema non esegue DDL automatico a ogni cold start:
`npm run migrate:gemma` esegue la migrazione controllata.

## Allegati

La Preview può usare il fallback BYTEA nello schema `gemma`. In production il
fallback DB è bloccato per evitare crescita incontrollata: prima del rilascio va
collegato uno storage Blob privato. Il progetto segnala lo stato dello storage
nell'endpoint health.

## Prestazioni

Il backend separa pool Knowledge e pool operativi, usa cursor pagination per i
ticket, query batch per la cronologia conversazioni, rate limiting AI e invio
email post-response. Il client riceve il testo in streaming mentre Gemma parla.
