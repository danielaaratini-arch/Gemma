# Architettura Gemma

## Obiettivo

Gemma nasce da zero per evitare la sovrapposizione di classificatori, regex e stati concorrenti che può limitare la comprensione del turno.

## Percorso di un turno

1. Il browser invia il messaggio corrente e una finestra breve di conversazione.
2. Il retrieval cerca i chunk attivi nel DB condiviso con full-text search.
3. Per ogni hit vengono inclusi anche i chunk adiacenti, così una riga di tabella o uno step non perde il proprio contesto.
4. Una sola chiamata al modello riceve conversazione + contenuto certificato.
5. Il modello decide il significato del turno e produce la risposta.
6. La risposta viene inoltrata progressivamente al browser.
7. Il browser conserva il contesto della sessione; questa preview non scrive conversazioni o ticket nel DB condiviso.

## Cosa non c'è

- nessun classificatore linguistico a regex;
- nessuna seconda AI che corregge la prima;
- nessun ramo speciale per singoli Paesi, modelli di telefono o frasi;
- nessuna migrazione sul DB Lia/Alda;
- nessuna scrittura sulla knowledge condivisa.

## Guardrail mantenuti

- dati Tiscali specifici solo dal contenuto recuperato;
- nessuna azione esterna dichiarata se non è realmente disponibile;
- nessun salto implicito di un controllo diagnostico;
- una risposta breve viene interpretata nel contesto, non considerata automaticamente come esito di troubleshooting.

## Prestazioni

Il backend misura separatamente retrieval, generazione AI e tempo totale. Lo streaming rende visibile il testo appena arriva senza attendere la risposta completa.
