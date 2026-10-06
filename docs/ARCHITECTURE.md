# Architettura Gemma

## Flusso ordinario

```
Utente
  ↓
cronologia recente nel browser
  ↓
retrieval read-only
  ├─ richiesta attuale (peso principale)
  └─ contesto recente (peso secondario)
  ↓
chunk rilevanti + chunk adiacenti
  ↓
UNICA chiamata al modello
  ↓
streaming testo
  ↓
UI + voce
```

## Divisione delle responsabilità

### Modello
Interpreta significato, correzioni, negazioni, chiarimenti, cambi argomento e risposte indirette.

### Retrieval
Trova materiale certificato. Non decide il significato della frase dell'utente.

### Codice
Protegge accessi, forza il DB in read-only, limita dimensioni e tempi, trasporta lo stream e mantiene la sessione locale.

## Regole minime

1. Rispondere prima alla richiesta attuale.
2. Non richiedere fatti già noti.
3. Un chiarimento non cancella il flusso precedente.
4. Un solo controllo diagnostico per turno.
5. Dati Tiscali specifici soltanto dal contenuto recuperato.
6. Nessuna azione dichiarata se non è stata davvero eseguita.
7. Nessun link o dettaglio interno della knowledge esposto al cliente.

## Prestazioni

Il backend misura retrieval, AI e tempo totale. Il testo viene mostrato mentre arriva dal modello; non si attende la risposta completa.

## Scritture

La Preview Gemma non persiste conversazioni o ticket sul DB condiviso. Ogni query di knowledge avviene dentro `BEGIN READ ONLY`, così una regressione applicativa non può trasformare il percorso di retrieval in una scrittura all'interno della transazione.
