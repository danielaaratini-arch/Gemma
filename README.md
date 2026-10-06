# Gemma

Gemma è la preview sperimentale TAAP progettata da zero per ridurre la logica rigida nel motore conversazionale.

## Principi

- un unico modello interpreta semanticamente il turno;
- il codice recupera le fonti, conserva il contesto e applica soltanto vincoli tecnici;
- nessun sistema di regex viene usato per classificare il linguaggio dell'utente;
- la knowledge condivisa viene interrogata esclusivamente in lettura;
- nessuna migrazione o scrittura sul database di Lia/Alda;
- il GLB di Alda viene letto durante la build, copiato nella build di Gemma e trasformato in versione bionda; a runtime Gemma usa il proprio asset;
- deployment sul branch `gemma-preview`.

## Sicurezza della preview

Gemma non contiene endpoint di scrittura verso il database condiviso. Il motore conversazionale usa una singola chiamata al modello per turno; il recupero della knowledge è separato dal ragionamento.
