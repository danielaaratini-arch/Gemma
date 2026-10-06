import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

const REQUEST_DELAY_MS = 200;
const DYNAMIC_WAIT_MS = 1200;
const CHUNK_SIZE = 1200;
const MIN_CONTENT_LENGTH = 80;

const DYNAMIC_HOSTNAMES = new Set()

function normalizeText(value = "") {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/* KNOWLEDGE_FINAL_HYGIENE_V2_4_PERSISTENT
 * Regole deterministiche applicate all'ingest per impedire che
 * bonifiche già approvate riemergano durante il sync massivo.
 * Nessun routing runtime, nessuna nuova chiamata AI.
 */
const KNOWLEDGE_FINAL_HYGIENE_EXCLUDED_FILES = new Set(
[
  "internet-telefono-guida-tcp-ip.html",
  "internet-telefono-modem-guida-ottimizza-rete-.html",
  "mobile-guida-mesevero.html",
  "mobile.html",
  "servizi-guida-kaspersky-security.html",
  "sicurezza-office-security.html",
  "supporto-moduli-servizi-hosting_domini-info_pagamenti-php.html"
]
)

const KNOWLEDGE_FINAL_HYGIENE_TITLE_BY_FILE = {
  "supporto-moduli-servizi-hosting_domini-info_alias-php.html": "Alias di dominio e posta elettronica",
  "servizi-tiscali-mail-guida-tiscali-mail-abilita-autenticazione-due-fattori.html": "Tiscali Mail - Abilita autenticazione a due fattori",
  "servizi-tiscali-mail-guida-tiscali-mail-accesso-autenticazione-due-fattori.html": "Tiscali Mail - Accesso con autenticazione a due fattori",
  "servizi-tiscali-mail-guida-tiscali-mail-disabilita-autenticazione-due-fattori.html": "Tiscali Mail - Disabilita autenticazione a due fattori",
  "servizi-tiscali-mail-guida-tiscali-mail-modifica-numero-cellulare.html": "Tiscali Mail - Modifica numero cellulare",
  "servizi-tiscali-mail-guida-tiscali-mail-recupero-password.html": "Tiscali Mail - Recupero password",
  "supporto-moduli-servizi-hosting_domini-info_dominio-php.html": "Supporto gestione dominio e spazio web",
  "supporto-moduli-servizi-hosting_domini-auth_code-php.html": "AuthInfo e Authorization Code",
  "informazioni-supporto-guida-app-tiscali-ios-sincronizzazione.html": "App Tiscali.it - iOS - Sincronizzazione messaggi",
  "informazioni-supporto-guida-app-tiscali-ios-inoltroallegato.html": "App Tiscali.it - iOS - Inoltro allegati",
  "informazioni-supporto-guida-app-tiscali-ios-imposta-account.html": "App Tiscali.it - iOS - Impostazioni account",
  "informazioni-supporto-guida-app-tiscali-ios-nuovoaccount.html": "App Tiscali.it - iOS - Nuovo account",
  "informazioni-supporto-guida-app-tiscali-ios-personalizzahp.html": "App Tiscali.it - iOS - Personalizzazione home page",
  "informazioni-supporto-guida-app-tiscali-android-imposta-account.html": "App Tiscali.it - Android - Impostazioni account",
  "informazioni-supporto-guida-app-tiscali-android-spazio-archiviazione.html": "App Tiscali.it - Android - Spazio di archiviazione",
  "informazioni-supporto-guida-app-tiscali-android-nuovoaccount.html": "App Tiscali.it - Android - Nuovo account",
  "informazioni-supporto-guida-app-tiscali-android-personalizzahp.html": "App Tiscali.it - Android - Personalizzazione home page",
  "informazioni-supporto-guida-app-tiscali-android-preferenzevisualizzazione.html": "App Tiscali.it - Android - Preferenze di visualizzazione",
  "informazioni-supporto-guida-app-tiscali-android-sincronizza.html": "App Tiscali.it - Android - Sincronizzazione messaggi",
  "servizi-guida-smallofficesecurity-attivazione.html": "Small Office Security - Attivazione",
  "servizi-guida-smallofficesecurity-installazione.html": "Small Office Security - Installazione",
  "servizi-guida-smallofficesecurity.html": "Small Office Security - Informazioni generali",
  "internet-telefono-modem-guida-LTE-100MB-indoor.html": "Naviga fino a 100MB con Ultrainternet Wireless - indoor",
  "internet-telefono-modem-guida-LTE-100MB-outdoor.html": "Naviga fino a 100MB con Ultrainternet Wireless - outdoor",
  "informazioni-supporto-guida-app-tiscali-android-cambiopassword.html": "App Tiscali.it - Android - Cambio password",
  "informazioni-supporto-guida-app-tiscali-ios-cambiopassword.html": "App Tiscali.it - iOS - Cambio password",
  "informazioni-supporto-guida-app-tiscali-android-inoltroallegato.html": "App Tiscali.it - Android - Inoltro allegati"
}

const KNOWLEDGE_FINAL_HYGIENE_DESCRIPTION_BY_FILE = {
  "supporto-moduli-servizi-hosting_domini-info_alias-php.html": "Informazioni sugli alias di dominio e sugli alias di posta elettronica e sulla loro gestione tramite i pannelli del dominio.",
  "internet-telefono-guida-chi-e.html": "Il servizio CHI È consente di visualizzare sul telefono fisso il numero del chiamante e, sui telefoni compatibili, memorizzare numero, data e ora delle chiamate ricevute.",
  "internet-telefono-guida-override.html": "Il servizio Override consente, su richiesta dell’intestatario e per un periodo limitato, di visualizzare il numero chiamante anche quando è anonimo o oscurato.",
  "internet-telefono-modem-technicolor-tg789vacv2-guida-collegamento-tg789vacv2.html": "Come collegare il modem Technicolor TG789vac v2 al proprio impianto telefonico.",
  "internet-telefono-modem-zyxel-pmg5705-t10a-guida-collegamento-pmg5705-t10a.html": "Come collegare il modem Zyxel PMG5705-T10A al servizio e utilizzare il collegamento Wi-Fi tramite WPS.",
  "internet-telefono-modem-technicolor-tg788vnv2-guida-collegamento-tg788vnv2.html": "Come collegare il modem Technicolor TG788vn v2 al proprio impianto telefonico",
  "internet-telefono-modem-technicolor-tg788vnv2-guida-collegamento-tg788vnv2-adsl-voce-modem.html": "Come collegare il modem Technicolor TG788vn v2 al proprio impianto telefonico",
  "internet-telefono-modem-technicolor-tg789vacv2-guida-collegamento-tg789vacv2-adsl-voce.html": "Come collegare il modem Technicolor TG789vac v2 al proprio impianto telefonico",
  "internet-telefono-modem-technicolor-tg788vnv2-guida-collegamento-tg788vnv2-adsl-voce.html": "Come collegare il modem Technicolor TG788vn v2 al proprio impianto telefonico",
  "internet-telefono-modem-technicolor-tg789vacv2-guida-collegamento-tg789vacv2-adsl-fibra-voce-modem2.html": "Come collegare il modem Technicolor TG789vac v2 al proprio impianto telefonico",
  "internet-telefono-modem-technicolor-tg789vacv2-guida-collegamento-tg789vacv2-adsl-fibra-voce-modem.html": "Come collegare il modem Technicolor TG789vac v2 per il servizio ADSL/Fibra FTTCab con Voce erogata tramite modem.",
  "internet-telefono-modem-zte-zxhn-h5745-guida-collegamento-fibra-h5745.html": "Come collegare il modem ZTE ZXHN H5745 al servizio Fibra FTTHome con Voce.",
  "internet-telefono-modem-technicolor-tg788vnv2-guida-collegamento-tg788vnv2-fibra-voce.html": "Come collegare il modem Technicolor TG788vn v2 al proprio impianto telefonico",
  "internet-telefono-modem-thomson-tg585v7-guida-collegamento-tg585v7.html": "Come collegare il modem Thomson TG585v7 al proprio impianto telefonico per i servizi ADSL e ADSL + Voce.",
  "internet-telefono-modem-technicolor-tg788vnv2-guida-gestione-porte-tg788vnv2.html": "Per assegnare un intervallo di porte TCP/UDP ai dispositivi collegati in rete locale al modem Technicolor TG788vn v2, segui questi passaggi.",
  "internet-telefono-modem-technicolor-tg582n-guida-gestione-porte-tg582n.html": "Per assegnare un intervallo di porte TCP/UDP ai dispositivi collegati in rete locale al modem Technicolor TG582n, segui questi passaggi.",
  "internet-telefono-modem-technicolor-tg784nv3-guida-gestione-porte-tg784nv3.html": "Per assegnare un intervallo di porte TCP/UDP ai dispositivi collegati in rete locale al modem Technicolor TG784n v3, segui questi passaggi.",
  "internet-telefono-modem-tiscali-netbox-n-guida-gestione-porte-netbox-n.html": "Per assegnare un intervallo di porte TCP/UDP ai dispositivi collegati in rete locale al modem Tiscali Netbox N, segui questi passaggi.",
  "internet-telefono-modem-zyxel-vmg8924-b10d-guida-collegamento-vmg8924-b10d-adsl-voce.html": "Come collegare il modem Zyxel VMG8924-B10D al proprio impianto telefonico",
  "internet-telefono-modem-zyxel-vmg8924-b10d-guida-collegamento-vmg8924-b10d-adsl-fibra-voce-modem2.html": "Come collegare il modem Zyxel VMG8924-B10D al proprio impianto telefonico",
  "internet-telefono-modem-zyxel-vmg8924-b10d-guida-collegamento-vmg8924-b10d-adsl-fibra-voce-modem.html": "Come collegare il modem Zyxel VMG8924-B10D al proprio impianto telefonico",
  "internet-telefono-modem-zyxel-vmg8924-b10d-guida-collegamento-vmg8924-b10d-fibra-voce.html": "Come collegare il modem Zyxel VMG8924-B10D al proprio impianto telefonico",
  "internet-telefono-modem-zyxel-vmg8924-b10d-guida-collegamento-vmg8924-b10d-adsl-voce-modem3.html": "Come collegare il modem Zyxel VMG8924-B10D al proprio impianto telefonico"
}

const KNOWLEDGE_FINAL_HYGIENE_REPLACEMENTS_BY_FILE = {
  "servizi-guida-spazioweb.html": [
    [
      "Scarica i filePer",
      "Scarica i file. Per"
    ]
  ],
  "servizi-guida-tiscalimysite.html": [
    [
      "PremiumProva Gratis MySite",
      "Premium. Prova Gratis MySite"
    ]
  ],
  "internet-telefono-guida-attivazione-servizio.html": [
    [
      "stato di attivazionePuoi",
      "stato di attivazione. Puoi"
    ]
  ],
  "servizi-tiscali-mail-guida-tiscali-mail-abilita-autenticazione-due-fattori.html": [
    [
      "Tiscali MailAbilita",
      "Tiscali Mail - Abilita"
    ]
  ],
  "servizi-tiscali-mail-guida-tiscali-mail-accesso-autenticazione-due-fattori.html": [
    [
      "Tiscali MailAccesso",
      "Tiscali Mail - Accesso"
    ]
  ],
  "servizi-tiscali-mail-guida-tiscali-mail-disabilita-autenticazione-due-fattori.html": [
    [
      "Tiscali MailDisabilita",
      "Tiscali Mail - Disabilita"
    ]
  ],
  "servizi-tiscali-mail-guida-tiscali-mail-modifica-numero-cellulare.html": [
    [
      "Tiscali MailModifica",
      "Tiscali Mail - Modifica"
    ]
  ],
  "servizi-tiscali-mail-guida-tiscali-mail-recupero-password.html": [
    [
      "Tiscali MailRecupero",
      "Tiscali Mail - Recupero"
    ]
  ],
  "servizi-guida-configurazione-pec.html": [
    [
      "posta elettronicaPuoi",
      "posta elettronica. Puoi"
    ],
    [
      "webmailPer",
      "webmail. Per"
    ]
  ],
  "servizi-guida-posta-mac-mail.html": [
    [
      "campo Autenticazion seleziona",
      "campo Autenticazione seleziona"
    ]
  ],
  "servizi-guida-posta-windows-outlook-2013.html": [
    [
      "pulsanteAltre",
      "pulsante Altre"
    ],
    [
      "crittograffata",
      "crittografata"
    ]
  ],
  "servizi-guida-posta-windows-outlook-2016.html": [
    [
      "pulsanteAltre",
      "pulsante Altre"
    ],
    [
      "crittograffata",
      "crittografata"
    ]
  ],
  "servizi-guida-pec.html": [
    [
      "GestoreInformativa",
      "Gestore. Informativa"
    ],
    [
      "GestoreManuale",
      "Gestore. Manuale"
    ],
    [
      "Tiscali PECCome",
      "Tiscali PEC. Come"
    ],
    [
      "postaI parametri",
      "posta. I parametri"
    ],
    [
      "webmailAccedi",
      "webmail. Accedi"
    ],
    [
      "AssistenzaAssistenza",
      "Assistenza. Assistenza"
    ]
  ],
  "servizi-guida-tnotice.html": [
    [
      "Cos'è tNoticetNotice",
      "Cos'è tNotice. tNotice"
    ],
    [
      "Come si utilizza tNoticeAprendo",
      "Come si utilizza tNotice. Aprendo"
    ],
    [
      "Condizioni del servizioContratto TiscaliContratto tNotice",
      "Condizioni del servizio. Contratto Tiscali. Contratto tNotice"
    ],
    [
      "Assistenza tNoticePer",
      "Assistenza tNotice. Per"
    ],
    [
      "Recupero passwordPer",
      "Recupero password. Per"
    ],
    [
      "Domande frequentiTrova",
      "Domande frequenti. Trova"
    ]
  ],
  "informazioni-supporto-guida-fattura-elettronica.html": [
    [
      "Documenti scaricabiliGuida",
      "Documenti scaricabili. Guida"
    ]
  ],
  "informazioni-supporto-guida-costi-mancata-restituzione-modem-tiscali.html": [
    [
      "Magazzino VerbaschiVia dei Verbaschi",
      "Magazzino Verbaschi, Via dei Verbaschi"
    ]
  ],
  "internet-telefono-guida-codice-migrazione.html": [
    [
      "Passa a Tiscali da TIMPassa a Tiscali da FastwebPassa a Tiscali da WindTrePassa a Tiscali da Vodafone",
      "Passa a Tiscali da TIM\nPassa a Tiscali da Fastweb\nPassa a Tiscali da WindTre\nPassa a Tiscali da Vodafone"
    ],
    [
      "159.Il",
      "159. Il"
    ]
  ],
  "informazioni-supporto-guida-progetto-misura-internet.html": [
    [
      "pacchettiLeggi",
      "pacchetti. Leggi"
    ]
  ],
  "informazioni-contratto-guida-costi-disattivazione-partitaiva.html": [
    [
      "Rete TiscaliCodici tecnologia001, 002, 003, 004",
      "Rete Tiscali\nCodici tecnologia\n001, 002, 003, 004"
    ]
  ],
  "internet-telefono-modem-gemtek-wvrtm-130acn-guida-attiva-disattiva-wifi-wvrtm-130acn.html": [
    [
      "voceImpostazioni",
      "voce Impostazioni"
    ],
    [
      "5GHZ.Nella",
      "5GHz. Nella"
    ]
  ],
  "internet-telefono-modem-gemtek-wltfgt-145acn-guida-attiva-disattiva-wifi-wltfgt-145acn.html": [
    [
      "voceImpostazioni",
      "voce Impostazioni"
    ],
    [
      "5GHZ.Nella",
      "5GHz. Nella"
    ]
  ],
  "internet-telefono-modem-technicolor-tg789vnv3-guida-attiva-disattiva-wifi-tg789vnv3.html": [
    [
      "DisattivazionePer",
      "Disattivazione. Per"
    ],
    [
      "AttivazionePer",
      "Attivazione. Per"
    ]
  ],
  "internet-telefono-modem-guida-kit-fibra.html": [
    [
      "segnale otticoVerde",
      "segnale ottico. Verde"
    ]
  ],
  "informazioni-supporto-guida-modem-tiscali.html": [
    [
      "sostituzione del modemPer",
      "sostituzione del modem. Per"
    ]
  ],
  "internet-telefono-modem-technicolor-tg789vacv2-guida-password-wifi-tg789vacv2.html": [
    [
      "password..",
      "password."
    ]
  ],
  "internet-telefono-modem-technicolor-dga4130ti-guida-password-wifi-dga4130ti.html": [
    [
      "password..",
      "password."
    ]
  ],
  "internet-telefono-modem-guida-LTE-100MB-outdoor.html": [
    [
      "canale Wi-Fi del modemSe",
      "canale Wi-Fi del modem. Se"
    ]
  ],
  "internet-telefono-modem-guida-LTE-100MB-indoor.html": [
    [
      "canale Wi-Fi del modemSe",
      "canale Wi-Fi del modem. Se"
    ]
  ],
  "internet-telefono-modem-guida-adsl-20MB.html": [
    [
      "canale Wi-Fi del modemSe",
      "canale Wi-Fi del modem. Se"
    ]
  ],
  "mobile-guida-hotspot-ios.html": [
    [
      "campi:APN: tiscalimobileinternetNome utente: [vuoto]Password: [vuoto]",
      "campi:\nAPN: tiscalimobileinternet\nNome utente: [vuoto]\nPassword: [vuoto]"
    ],
    [
      "HOTSPOT PERSONALEAPN: tiscalimobileinternetNome utente: [vuoto]Password: [vuoto]",
      "HOTSPOT PERSONALE\nAPN: tiscalimobileinternet\nNome utente: [vuoto]\nPassword: [vuoto]"
    ]
  ],
  "informazioni-supporto-guida-numero-cliente.html": [
    [
      "fattura TiscaliPuoi",
      "fattura Tiscali. Puoi"
    ],
    [
      "OnlineNella",
      "Online. Nella"
    ]
  ],
  "servizi-guida-password-manager.html": [
    [
      "dell'installazioneVerifica",
      "dell'installazione. Verifica"
    ]
  ],
  "informazioni-supporto-guida-registro-pubblico-opposizioni.html": [
    [
      "AbbonatiUfficio Roma NomentanaC.P. 7211",
      "Abbonati, Ufficio Roma Nomentana, C.P. 7211"
    ]
  ],
  "servizi-guida-smallofficesecurity.html": [
    [
      "all'intstallazioneGuida",
      "all'installazione. Guida"
    ],
    [
      "FunzionalitàPersonal computerFile server",
      "Funzionalità\nPersonal computer\nFile server"
    ]
  ],
  "servizi-guida-totalsecurity.html": [
    [
      "Total SecurityCome",
      "Total Security. Come"
    ]
  ],
  "informazioni-supporto-guida-truffe-telefoniche-00001.html": [
    [
      "Finto aumento canoneAlcuni",
      "Finto aumento canone. Alcuni"
    ],
    [
      "Finte difficoltà in attivazioneAlcuni",
      "Finte difficoltà in attivazione. Alcuni"
    ]
  ],
  "internet-telefono-modem-compatibile-fritzbox-7490-guida-internet-fritzbox-7490.html": [
    [
      "riavvio deo modem",
      "riavvio del modem"
    ],
    [
      "seleziona lopzione",
      "seleziona l'opzione"
    ],
    [
      "l'acesso a Internet",
      "l'accesso a Internet"
    ],
    [
      "\\n\\nPer aggiornare il FRITZ!Box manualmente seguire la seguente procedura: https://it.avm.de/assistenza/fritzbox/fritzbox-7590/banca-dati-informativa/publication/show/1574_Eseguire-l-aggiornamento-manuale-di-FRITZ-OS/",
      ""
    ],
    [
      "Per aggiornare il FRITZ!Box manualmente seguire la seguente procedura: https://it.avm.de/assistenza/fritzbox/fritzbox-7590/banca-dati-informativa/publication/show/1574_Eseguire-l-aggiornamento-manuale-di-FRITZ-OS/",
      ""
    ]
  ],
  "internet-telefono-modem-technicolor-tg784nv3-guida-collegamento-tg784nv3.html": [
    [
      "modem Technicolor TG788vn v2.Per",
      "modem Technicolor TG784n v3. Per"
    ]
  ],
  "internet-telefono-modem-technicolor-tg784nv3-guida-password-wifi-tg784nv3.html": [
    [
      "modem Technicolor TG789vn v3.Per",
      "modem Technicolor TG784n v3. Per"
    ]
  ],
  "internet-telefono-modem-technicolor-tg784nv3-guida-gestione-porte-tg784nv3.html": [
    [
      "Technicolor TG788vn v3",
      "Technicolor TG784n v3"
    ]
  ],
  "internet-telefono-modem-technicolor-tg582n-guida-gestione-porte-tg582n.html": [
    [
      "Technicolor TG788vn v3",
      "Technicolor TG582n"
    ]
  ],
  "internet-telefono-modem-technicolor-tg788vnv2-guida-gestione-porte-tg788vnv2.html": [
    [
      "Technicolor TG788vn v3",
      "Technicolor TG788vn v2"
    ]
  ],
  "internet-telefono-modem-tiscali-netbox-n-guida-gestione-porte-netbox-n.html": [
    [
      "Technicolor TG788vn v3",
      "Tiscali Netbox N"
    ]
  ],
  "servizi-guida-gestione-hosting.html": [
    [
      "attivato il servizio di Hosting.Leggi",
      "attivato il servizio di Hosting. Leggi"
    ],
    [
      "Area clienti Hosting e DominiManuale Pannello di controllo hostingAuthInfo e Authorization CodeAccedi a Tiscali PECInformazioni su Tiscali PEC",
      "Area clienti Hosting e Domini\nManuale Pannello di controllo hosting\nAuthInfo e Authorization Code\nAccedi a Tiscali PEC\nInformazioni su Tiscali PEC"
    ]
  ],
  "internet-telefono-modem-technicolor-tg582nv2-guida-luci-tg582nv2.html": [
    [
      "Punto di acesso",
      "Punto di accesso"
    ]
  ],
  "informazioni-supporto-guida-telefonico.html": [
    [
      "dall’Italia.Il",
      "dall’Italia. Il"
    ],
    [
      "veloci.Il",
      "veloci. Il"
    ],
    [
      "24:00.Le",
      "24:00. Le"
    ]
  ],
  "mobile-guida-segreteria-telefonica-mobile.html": [
    [
      "36 3701234567Esempio",
      "36 3701234567\nEsempio"
    ]
  ],
  "servizi-guida-smallofficesecurity-installazione.html": [
    [
      "fornitore del servizio.Dopo",
      "fornitore del servizio. Dopo"
    ],
    [
      "avviata l'installazione.L'installazione",
      "avviata l'installazione. L'installazione"
    ],
    [
      "dell'applicazione.Fare",
      "dell'applicazione. Fare"
    ],
    [
      "pulsante Fine.Tutti",
      "pulsante Fine. Tutti"
    ],
    [
      "dell'installazione.In alcuni",
      "dell'installazione. In alcuni"
    ]
  ],
  "servizi-guida-internetsecurity.html": [
    [
      "Il codice di attivazione è valido fino alla fine del 2018. ",
      ""
    ],
    [
      "PC WindowsComputer MacDispositivi AndroidDispositivi iOSDispositivi Windows Phone",
      "PC Windows\nComputer Mac\nDispositivi Android\nDispositivi iOS\nDispositivi Windows Phone"
    ]
  ],
  "internet-telefono-modem-guida-fibra-J4Gplus-100MB-DH335.html": [
    [
      "superiore.Può",
      "superiore. Può"
    ]
  ],
  "informazioni-supporto-guida-semaforo-agcom.html": [
    [
      "2,5Gbps).Architettura",
      "2,5 Gbps). Architettura"
    ],
    [
      "1Gbps).Architettura",
      "1 Gbps). Architettura"
    ],
    [
      "Gigabit/sVelocità",
      "Gigabit/s\nVelocità"
    ],
    [
      "Megabit/s Velocità",
      "Megabit/s\nVelocità"
    ],
    [
      "Megabit/sVelocità",
      "Megabit/s\nVelocità"
    ],
    [
      "msec.Tasso",
      " msec.\nTasso"
    ],
    [
      "MbpsIn upload",
      "Mbps\nIn upload"
    ],
    [
      "Ultrainternet Fibra AffariUltrainternet Fibra Full Affari",
      "Ultrainternet Fibra Affari\nUltrainternet Fibra Full Affari"
    ],
    [
      "Ultrainternet AffariUltrainternet Full Affari",
      "Ultrainternet Affari\nUltrainternet Full Affari"
    ],
    [
      "Ultrainternet WirelessUltrainternet Wireless FullUltraInternet Wireless Ricaricabile",
      "Ultrainternet Wireless\nUltrainternet Wireless Full\nUltraInternet Wireless Ricaricabile"
    ],
    [
      "Ultrainternet Wireless AffariUltrainternet Wireless Full AffariUltraInternet Wireless Ricaricabile Affari",
      "Ultrainternet Wireless Affari\nUltrainternet Wireless Full Affari\nUltraInternet Wireless Ricaricabile Affari"
    ],
    [
      "ADSL OPENADSL FULL",
      "ADSL OPEN\nADSL FULL"
    ],
    [
      "ADSL OPEN AFFARIADSL FULL AFFARI",
      "ADSL OPEN AFFARI\nADSL FULL AFFARI"
    ],
    [
      "Megabit/sRitardo",
      "Megabit/s\nRitardo"
    ]
  ],
  "supporto-moduli-servizi-hosting_domini-info_alias-php.html": [
    [
      "Se desideri ottenere informazioni sullo stato dei pagamenti effettuati, compila il modulo.",
      ""
    ]
  ]
}

const KNOWLEDGE_FINAL_HYGIENE_REPLACE_ONCE_BY_FILE = {
  "servizi-guida-totalsecurity.html": [
    [
      "Total Security\n\nScarica ora Total Security. Come installare e attivare il programma\n\nWindows 10 (32 bit e 64 bit)OS X 10.8, 10.9, 10.10AndroidiOS 7.0 o versione successivaWindows Phone 8\n\nPC WindowsComputer MacDispositivi AndroidDispositivi iOSDispositivi Windows Phone\n\nWindows 10 (32 bit e 64 bit)OS X 10.8, 10.9, 10.10AndroidiOS 7.0 o versione successivaWindows Phone 8\n\nPC WindowsComputer MacDispositivi AndroidDispositivi iOSDispositivi Windows Phone\n\nQuando la tua famiglia è online, puoi fare in modo che non sia solo connessa, ma anche protetta. La sicurezza pluripremiata di Total Security ti consente di proteggere la tua famiglia, inclusi privacy, denaro e ricordi preziosi, su PC, Mac, dispositivi mobili Android, iOS e Windows Phone.\n\nLa licenza all'uso del software è limitata a un periodo di 12 mesi a decorrere dalla data di attivazione sul primo dispositivo.\n\nL'acquisto di Kaspersky Total Security – Multi-Device comprende una versione Premium dei servizi Kaspersky Password Manager e Kaspersky Safe Kids.",
      "Total Security\n\nScarica ora Total Security. Come installare e attivare il programma\n\nWindows 10 (32 bit e 64 bit)\nOS X 10.8, 10.9, 10.10\nAndroid\niOS 7.0 o versione successiva\nWindows Phone 8\n\nPC Windows\nComputer Mac\nDispositivi Android\nDispositivi iOS\nDispositivi Windows Phone\n\nQuando la tua famiglia è online, puoi fare in modo che non sia solo connessa, ma anche protetta. La sicurezza pluripremiata di Total Security ti consente di proteggere la tua famiglia, inclusi privacy, denaro e ricordi preziosi, su PC, Mac, dispositivi mobili Android, iOS e Windows Phone.\n\nLa licenza all'uso del software è limitata a un periodo di 12 mesi a decorrere dalla data di attivazione sul primo dispositivo.\n\nL'acquisto di Kaspersky Total Security – Multi-Device comprende una versione Premium dei servizi Kaspersky Password Manager e Kaspersky Safe Kids."
    ]
  ],
  "servizi-guida-smallofficesecurity-installazione.html": [
    [
      "Che il sistema operativo e il Service Pack soddisfino i requisiti software\nChe tutte le applicazioni richieste siano disponibili\nChe la quantità di spazio disponibile su disco sia sufficiente per l'installazione\nChe l'utente che installa l'applicazione abbia privilegi di amministratore\n\nChe il sistema operativo e il Service Pack soddisfino i requisiti software\n\nChe tutte le applicazioni richieste siano disponibili\n\nChe la quantità di spazio disponibile su disco sia sufficiente per l'installazione\n\nChe l'utente che installa l'applicazione abbia privilegi di amministratore\n\nSe uno dei requisiti elencati in precedenza non è soddisfatto, verrà visualizzata una notifica.\n\nPresenza di applicazioni incompatibili nel computer. Se vengono rilevate applicazioni incompatibili, queste sono visualizzate in un elenco e viene richiesto all'utente se desidera rimuoverle. Le applicazioni che non vengono rimosse automaticamente da Kaspersky Small Office Security devono essere rimosse manualmente. Durante la rimozione delle applicazioni incompatibili, sarà necessario riavviare il sistema. Dopo il riavvio, l'installazione di Kaspersky Small Office Security continuerà automaticamente.",
      "Che il sistema operativo e il Service Pack soddisfino i requisiti software\nChe tutte le applicazioni richieste siano disponibili\nChe la quantità di spazio disponibile su disco sia sufficiente per l'installazione\nChe l'utente che installa l'applicazione abbia privilegi di amministratore\n\nSe uno dei requisiti elencati in precedenza non è soddisfatto, verrà visualizzata una notifica.\n\nPresenza di applicazioni incompatibili nel computer. Se vengono rilevate applicazioni incompatibili, queste sono visualizzate in un elenco e viene richiesto all'utente se desidera rimuoverle. Le applicazioni che non vengono rimosse automaticamente da Kaspersky Small Office Security devono essere rimosse manualmente. Durante la rimozione delle applicazioni incompatibili, sarà necessario riavviare il sistema. Dopo il riavvio, l'installazione di Kaspersky Small Office Security continuerà automaticamente."
    ]
  ],
  "internet-telefono-modem-guida-ottimizza-rete.html": [
    [
      "ADSL\nSe la velocità della tua connessione internet è fino a 20 MEGA\nCome ottimizzare la rete Wi-Fi del modem ADSL\n\nUltrainternet Fibra\n\nSe la velocità della tua connessione internet è fino a 1 GIGA su rete FTTH\n\nOttieni il massimo con il Modem Genew HG326AC\n\nOttieni il massimo con il Modem Technicolor DGA4130TI\n\nOttieni il massimo con il Modem Zyxel PMG5705-T10A\n\nOttieni il massimo con il Modem AVM FRITZ!Box 7530\n\nOttieni il massimo con il Modem AVM FRITZ!Box 7590\n\nOttieni il massimo con il Modem ZTE ZXHN H388X (Tiscali Hub+)\n\nOttieni il massimo con il Modem ZTE ZXHN H3600\n\nUltrainternet\n\nSe la velocità della tua connessione internet fino a 200 MEGA su rete FTTC\n\nOttimizza la rete Ultrainternet fino a 200MB\n\nOttieni il massimo con il Modem Homix Smart Modem\n\nOttieni il massimo con il Modem ZTE ZXHN H388X (Tiscali Hub+)\n\nUltrainternet\n\nSe la velocità della tua connessione internet fino a 100 MEGA su rete FTTC\n\nOttimizza la rete Ultrainternet fino a 100MB\n\nOttieni il massimo con il Modem Homix Smart Modem\n\nUltrainternet Wireless\n\nSe la velocità della tua connessione internet fino a 100 MEGA su rete 4G+\n\nCome ottimizzare la rete se il modem è collegato all'antenna esterna",
      "ADSL\nSe la velocità della tua connessione internet è fino a 20 MEGA\nCome ottimizzare la rete Wi-Fi del modem ADSL"
    ]
  ],
  "internet-telefono-modem-guida-LTE-100MB-indoor.html": [
    [
      "Verifiche da eseguire sui dispositivi connessi alla rete WLAN (Wi-Fi)\n\nVerifica che tutti i dispositivi Wi-Fi che utilizzi supportino il più recente standard di rete 802.11ac (Wi-Fi AC) con classe AC300 o superiore.Può capitare che la lentezza della connessione coincida quando si connette un vecchio dispositivo (es.: iPhone 3Gs) che non supporta la connessione Wi-Fi N o Wi-Fi AC.\nSe tra i dispositivi connessi al Modem Wi-Fi è presente anche un solo dispositivo che non supporta lo standard Wi-Fi N o Wi-Fi AC, il modem deve adeguare la velocità di connessione al dispositivo più lento (es: utilizzando lo standard 802.11g), rallentando la connessione agli altri dispositivi già connessi anche se sono in grado di supportare standard più performanti.\n\nVerifica che tutti i dispositivi Wi-Fi che utilizzi supportino il più recente standard di rete 802.11ac (Wi-Fi AC) con classe AC300 o superiore.Può capitare che la lentezza della connessione coincida quando si connette un vecchio dispositivo (es.: iPhone 3Gs) che non supporta la connessione Wi-Fi N o Wi-Fi AC.",
      "Verifiche da eseguire sui dispositivi connessi alla rete WLAN (Wi-Fi)\n\nVerifica che tutti i dispositivi Wi-Fi che utilizzi supportino il più recente standard di rete 802.11ac (Wi-Fi AC) con classe AC300 o superiore. Può capitare che la lentezza della connessione coincida quando si connette un vecchio dispositivo (es.: iPhone 3Gs) che non supporta la connessione Wi-Fi N o Wi-Fi AC.\nSe tra i dispositivi connessi al Modem Wi-Fi è presente anche un solo dispositivo che non supporta lo standard Wi-Fi N o Wi-Fi AC, il modem deve adeguare la velocità di connessione al dispositivo più lento (es: utilizzando lo standard 802.11g), rallentando la connessione agli altri dispositivi già connessi anche se sono in grado di supportare standard più performanti."
    ],
    [
      "Se il problema persiste cambia il canale Wi-Fi del modem. Se il modem collocato in una posizione elevata ma il problema persiste puoi modificare il canale di trasmissione della connessione Wi-Fi. Seleziona il modello del tuo modem per leggere la guida alla modifica del canale WiFi.\n\nGemtek WLTFGT-145ACN\nHuawei B5318-42\nGreen Packet DH335\n\nHuawei B818-263\n\nGemtek WLTFGT-145ACN\nHuawei B5318-42\nGreen Packet DH335\n\nHuawei B818-263",
      "Se il problema persiste cambia il canale Wi-Fi del modem. Se il modem collocato in una posizione elevata ma il problema persiste puoi modificare il canale di trasmissione della connessione Wi-Fi. Seleziona il modello del tuo modem per leggere la guida alla modifica del canale WiFi.\n\nGemtek WLTFGT-145ACN\nHuawei B5318-42\nGreen Packet DH335\n\nHuawei B818-263"
    ]
  ],
  "internet-telefono-modem-guida-LTE-100MB-outdoor.html": [
    [
      "Verifiche da eseguire sui dispositivi connessi alla rete WLAN (Wi-Fi)\n\nVerifica che tutti i dispositivi Wi-Fi che utilizzi supportino il più recente standard di rete 802.11ac (Wi-Fi AC) con classe AC300 o superiore.Può capitare che la lentezza della connessione coincida quando si connette un vecchio dispositivo (es.: iPhone 3Gs) che non supporta la connessione Wi-Fi N o Wi-Fi AC.\nSe tra i dispositivi connessi al Modem Wi-Fi è presente anche un solo dispositivo che non supporta lo standard Wi-Fi N o Wi-Fi AC, il modem deve adeguare la velocità di connessione al dispositivo più lento (es: utilizzando lo standard 802.11g), rallentando la connessione agli altri dispositivi già connessi anche se sono in grado di supportare standard più performanti.\n\nVerifica che tutti i dispositivi Wi-Fi che utilizzi supportino il più recente standard di rete 802.11ac (Wi-Fi AC) con classe AC300 o superiore.Può capitare che la lentezza della connessione coincida quando si connette un vecchio dispositivo (es.: iPhone 3Gs) che non supporta la connessione Wi-Fi N o Wi-Fi AC.",
      "Verifiche da eseguire sui dispositivi connessi alla rete WLAN (Wi-Fi)\n\nVerifica che tutti i dispositivi Wi-Fi che utilizzi supportino il più recente standard di rete 802.11ac (Wi-Fi AC) con classe AC300 o superiore. Può capitare che la lentezza della connessione coincida quando si connette un vecchio dispositivo (es.: iPhone 3Gs) che non supporta la connessione Wi-Fi N o Wi-Fi AC.\nSe tra i dispositivi connessi al Modem Wi-Fi è presente anche un solo dispositivo che non supporta lo standard Wi-Fi N o Wi-Fi AC, il modem deve adeguare la velocità di connessione al dispositivo più lento (es: utilizzando lo standard 802.11g), rallentando la connessione agli altri dispositivi già connessi anche se sono in grado di supportare standard più performanti."
    ],
    [
      "Se il problema persiste cambia il canale Wi-Fi del modem. Se il modem collocato in una posizione elevata ma il problema persiste puoi modificare il canale di trasmissione della connessione Wi-Fi. Seleziona il modello del tuo modem per leggere la guida alla modifica del canale WiFi.\n\nHuawei B2328-42\nHuawei B2338\nGreen Packet OH335\n\nGemtek WVRTM-130ACN\nHuawei R2561\n\nHuawei B2328-42\nHuawei B2338\nGreen Packet OH335\n\nGemtek WVRTM-130ACN\nHuawei R2561",
      "Se il problema persiste cambia il canale Wi-Fi del modem. Se il modem collocato in una posizione elevata ma il problema persiste puoi modificare il canale di trasmissione della connessione Wi-Fi. Seleziona il modello del tuo modem per leggere la guida alla modifica del canale WiFi.\n\nHuawei B2328-42\nHuawei B2338\nGreen Packet OH335\n\nGemtek WVRTM-130ACN\nHuawei R2561"
    ]
  ]
}

const KNOWLEDGE_FINAL_HYGIENE_REMOVE_ONCE_BY_FILE = {
  "internet-telefono-modem-guida-ottimizza-rete.html": [
    "Come ottimizzare la rete se il modem non è collegato all'antenna esterna\n\nADSL\n\nSe la velocità della tua connessione internet è fino a 20 MEGA\n\nCome ottimizzare la rete Wi-Fi del modem ADSL"
  ],
  "informazioni-supporto-guida-semaforo-agcom.html": [
    "Velocità nominale di navigazione in download: 2,5 Gigabit/sVelocità nominale di navigazione in upload: 500 Megabit/s Velocità minima di navigazione in download: 100 Megabit/sVelocità minima di navigazione in upload: 3 Megabit/s Ritardo trasmissione dati (ritardo massimo): < 50msec.Tasso di perdita dei pacchetti: < 0,1%\n\nUltrainternet Fibra Ultrainternet Fibra Full\n\nUltrainternet Fibra AffariUltrainternet Fibra Full Affari\n\nVelocità nominale di navigazione in download: 1 Gigabit/sVelocità nominale di navigazione in upload: 300 Megabit/s Velocità minima di navigazione in download: 100 Megabit/sVelocità minima di navigazione in upload: 3 Megabit/s Ritardo trasmissione dati (ritardo massimo): < 50msec.Tasso di perdita dei pacchetti: < 0,1%\n\nUltrainternet Ultrainternet Full\n\nUltrainternet AffariUltrainternet Full Affari\n\nUltrainternet WirelessUltrainternet Wireless FullUltraInternet Wireless Ricaricabile\n\nUltrainternet Wireless AffariUltrainternet Wireless Full AffariUltraInternet Wireless Ricaricabile Affari\n\nADSL OPENADSL FULL\n\nADSL OPEN AFFARIADSL FULL AFFARI"
  ]
}

/* KNOWLEDGE_HYGIENE_V1: igiene deterministica dell'ingest, non routing runtime. */
const KNOWLEDGE_HYGIENE_NAVIGATION_LABELS = new Set([
  "Panoramica",
  "Posizionamento",
  "Collegamento",
  "Disattiva/Attiva Wi-Fi",
  "Pannello luci",
  "Spie del modem",
  "Funzionalità avanzate",
  "Reset del modem",
  "Sostituzione della SIM",
  "Collegamento all'impianto telefonico e tramite WPS",
  "collegamento all'impianto",
  "Configurazione Internet e VoIP",
  "Targhetta d'identificazione",
  "Manuali e Assistenza AVM",
  "Videoguide e Manuali AVM",
  "Torna all'indice delle funzionalità avanzate",
  "Ritorna all'elenco dei video",
  "Modifica il canale della rete Wi-Fi",
  "Modifica la password della rete Wi-Fi",
  "Gestione Porte TCP e UDP",
  "Riconfigurazione del modem",
  "Rinconfigurazione del modem",
  "Configurazione rete locale",
  "Port trigger",
  "Assistenza Tiscali Mail",
  "Introduzione",
  "Invia e ricevi i messaggi",
  "Gestione delle cartelle",
  "Risposta automatica",
  "Area Personale",
  "Area Personale | Primo accesso",
  "Area Personale | Profilo",
  "Abilita autenticazione due fattori",
  "Login autenticazione due fattori",
  "Disabilita autenticazione due fattori",
  "Recupero password",
  "Modifica numero cellulare",
  "Ripristino accesso",
  "Associazione numero cellulare",
  "Tiscali - Bad Request",
  "Windows 11",
  "Windows 10",
  "Windows 8",
  "Windows 7",
  "Windows Vista",
  "Windows XP",
  "Mac OS",
  "Linux",
].map((value) => hygieneKey(value)))

const KNOWLEDGE_HYGIENE_ASSISTANCE_INDEX_PATHS = new Set([
  "/internet-telefono",
  "/internet-telefono/modem",
  "/internet-telefono/modem-compatibile",
  "/domande-frequenti",
  "/modulistica",
  "/servizi",
  "/informazioni",
  "/supporto",
])

const OBSOLETE_PAYMENT_REFERENCES = [
  "IT52F0101504800000070471820",
  "60220183",
]

function hygieneKey(value = "") {
  return normalizeText(value)
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeLegacy3G(value = "") {
  let text = String(value).replace(/\b3G\b/gi, "2G")
  let previous = ""

  while (text !== previous) {
    previous = text
    text = text
      .replace(/\b2G\s*\/\s*2G\b/gi, "2G")
      .replace(/\b2G\s+(?:o|e)\s+2G\b/gi, "2G")
      .replace(/\b2G\s*,\s*2G\b/gi, "2G")
  }

  return text
}

function sanitizeImportedScalar(value = "") {
  return normalizeLegacy3G(
    normalizeText(String(value).replace(/\uFFFD/g, "")),
  )
}

function collapseAdjacentLines(value) {
  const lines = String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const result = []
  let previous = null

  for (const line of lines) {
    const key = hygieneKey(line)
    if (key && key === previous) continue
    result.push(line)
    previous = key
  }

  return result.join("\n")
}

function sanitizeImportedContent(value = "", title = "") {
  let text = normalizeLegacy3G(
    normalizeText(String(value).replace(/d\uFFFD?el/gi, "del").replace(/\uFFFD/g, "")),
  )
    .replace(/192130e\b/g, "192130 e")
    .replace(/IMPORTANTEEseguire/g, "IMPORTANTE: Eseguire")

  if (!text) return ""

  const rawParagraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const navigationMatches = new Set(
    rawParagraphs
      .map((paragraph) => hygieneKey(paragraph))
      .filter((key) => KNOWLEDGE_HYGIENE_NAVIGATION_LABELS.has(key)),
  )
  const navigationContext = navigationMatches.size >= 3
  const titleKey = hygieneKey(title)
  const cleaned = []

  for (const raw of rawParagraphs) {
    if (/continua a leggere/i.test(raw)) continue

    const rawKey = hygieneKey(raw)
    if (rawKey === "guida" && rawKey !== titleKey) continue
    if (
      navigationContext &&
      KNOWLEDGE_HYGIENE_NAVIGATION_LABELS.has(rawKey) &&
      rawKey !== titleKey
    ) {
      continue
    }

    const paragraph = collapseAdjacentLines(raw).trim()
    if (!paragraph) continue

    const paragraphKey = hygieneKey(paragraph)
    if (
      cleaned.length > 0 &&
      hygieneKey(cleaned[cleaned.length - 1]) === paragraphKey
    ) {
      continue
    }

    cleaned.push(paragraph)
  }

  // Alcuni template lasciano una navigazione di ritorno come ultimo paragrafo
  // anche quando il DOM non la espone come blocco autonomo. La eliminiamo
  // soltanto in posizione terminale e soltanto se ha forma di navigazione,
  // non di istruzione operativa. In questo modo il corpus non cambia per
  // elementi UI senza dipendere da modem, servizio, URL o frase specifica.
  while (cleaned.length > 1 && isTerminalNavigationParagraph(cleaned.at(-1))) {
    cleaned.pop()
  }

  return normalizeText(cleaned.join("\n\n"))
}

function isNonInformativeAssistanceShell(pageUrl = "", value = "") {
  let hostname = ""
  try {
    hostname = new URL(pageUrl).hostname.toLowerCase()
  } catch {
    return false
  }

  if (hostname !== "assistenza.tiscali.it") return false

  const paragraphs = String(value)
    .split(/\n{2,}/)
    .map((paragraph) => hygieneKey(paragraph))
    .filter(Boolean)

  if (paragraphs.length === 0 || paragraphs.length > 4) return false

  return paragraphs.every((paragraph) =>
    paragraph === "internet e telefono" ||
    paragraph === "servizio clienti per non udenti" ||
    paragraph === "argomenti utili" ||
    paragraph === "le guide ai servizi 4g fibra adsl e voce gestisci il tuo abbonamento e scopri le risposte alle domande piu frequenti"
  )
}

function containsObsoletePaymentReference(value = "") {
  const text = String(value).toUpperCase()
  return OBSOLETE_PAYMENT_REFERENCES.some((reference) => text.includes(reference))
}

function descriptionForImportedPage(page, source) {
  const explicit = sanitizeImportedScalar(page.description || "")
  if (explicit) return explicit.slice(0, 2000)

  const titleKey = hygieneKey(page.title)
  const candidates = String(page.content || "")
    .split(/\n{2,}/)
    .map((value) => normalizeText(value))
    .filter((value) => {
      if (value.length < 30) return false
      const key = hygieneKey(value)
      return key && key !== titleKey && !KNOWLEDGE_HYGIENE_NAVIGATION_LABELS.has(key)
    })

  return (candidates[0] || "Pagina importata da " + source.name).slice(0, 2000)
}

function shouldStoreKnowledgePage(source, pageUrl, page) {
  const canonicalPage = normalizeUrl(pageUrl, pageUrl)
  const canonicalSource = normalizeUrl(source.url, source.url)
  const fileName = buildVirtualFileName(canonicalPage || pageUrl)

  if (KNOWLEDGE_FINAL_HYGIENE_EXCLUDED_FILES.has(fileName)) {
    return false
  }

  if (canonicalPage && canonicalSource && canonicalPage === canonicalSource) {
    return false
  }

  try {
    const parsed = new URL(canonicalPage || pageUrl)
    if (
      parsed.hostname.toLowerCase() === "assistenza.tiscali.it" &&
      KNOWLEDGE_HYGIENE_ASSISTANCE_INDEX_PATHS.has(parsed.pathname.toLowerCase())
    ) {
      return false
    }
  } catch {
    // La validazione URL principale gestisce gia gli URL malformati.
  }

  if (/^Video guide FRITZ!Box\b/i.test(normalizeText(page.title || ""))) {
    return false
  }

  if (/^Funzionalità avanzate\b/i.test(normalizeText(page.title || ""))) {
    return false
  }

  return true
}

function splitLongTextAtBoundaries(value, maxLength) {
  const result = []
  let remaining = normalizeText(value)

  while (remaining.length > maxLength) {
    const minimum = Math.max(1, Math.floor(maxLength * 0.55))
    const window = remaining.slice(0, maxLength + 1)
    const boundaries = ["\n", ". ", "; ", ": ", ", ", " "]
    let cut = -1
    let consume = 0

    for (const boundary of boundaries) {
      const index = window.lastIndexOf(boundary, maxLength)
      if (index >= minimum) {
        cut = index
        consume = boundary === " " ? 1 : boundary.length
        break
      }
    }

    if (cut < minimum) {
      const nextSpace = remaining.indexOf(" ", maxLength)
      if (nextSpace >= 0) {
        cut = nextSpace
        consume = 1
      } else {
        cut = maxLength
        consume = 0
      }
    }

    const chunk = remaining.slice(0, cut + (consume > 1 ? consume - 1 : 0)).trim()
    if (chunk) result.push(chunk)
    remaining = remaining.slice(cut + consume).trim()
  }

  if (remaining) result.push(remaining)
  return result
}

function validateImportedChunks(chunks) {
  for (const chunk of chunks) {
    if (!normalizeText(chunk)) throw new Error("Chunk Knowledge vuoto dopo la sanificazione.")
    if (/\uFFFD/.test(chunk)) throw new Error("Chunk Knowledge con carattere Unicode U+FFFD.")
    if (/\b3G\b/i.test(chunk)) throw new Error("Chunk Knowledge con riferimento 3G non normalizzato.")
    if (/continua a leggere/i.test(chunk)) throw new Error("Chunk Knowledge con teaser incompleto.")
    if (containsObsoletePaymentReference(chunk)) {
      throw new Error("Chunk Knowledge con coordinate pagamento obsolete.")
    }
  }
}

function replaceOnceLiteral(value, from, to) {
  const text = String(value)
  const index = text.indexOf(from)
  if (index < 0) return text
  return text.slice(0, index) + to + text.slice(index + from.length)
}

function removeStandaloneParagraph(value, exactValue) {
  const target = hygieneKey(exactValue)
  return String(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && hygieneKey(paragraph) !== target)
    .join("\n\n")
}

function persistentImportedTitle(fileName, fallback) {
  return KNOWLEDGE_FINAL_HYGIENE_TITLE_BY_FILE[fileName] || fallback
}

function persistentImportedDescription(fileName, fallback) {
  return KNOWLEDGE_FINAL_HYGIENE_DESCRIPTION_BY_FILE[fileName] || fallback
}

function applyPersistentKnowledgeHygiene(fileName, value) {
  let text = String(value)

  text = text.replace(
    /(?:^|\n\n)(?:Ritorna|Torna) all['’]indice della guida [^\n]+(?=\n\n|$)/gi,
    "\n\n",
  )

  if (fileName.startsWith("internet-telefono-guida-tcp-ip-")) {
    text = text.replace(
      /(?:^|\n\n)Torna all['’]indice della guida "Configurazione TCP-IP"\s*(?=\n\n|$)/gi,
      "\n\n",
    )
  }

  if (fileName.startsWith("internet-telefono-modem-huawei-r2561-")) {
    text = removeStandaloneParagraph(text, "huawei-B2338")
  }

  if (fileName.startsWith("internet-telefono-modem-greenpacket-dh335-")) {
    text = removeStandaloneParagraph(text, "Green Packet OH 335")
  }

  for (const [from, to] of KNOWLEDGE_FINAL_HYGIENE_REPLACEMENTS_BY_FILE[fileName] || []) {
    text = text.split(from).join(to)
  }

  for (const [from, to] of KNOWLEDGE_FINAL_HYGIENE_REPLACE_ONCE_BY_FILE[fileName] || []) {
    text = replaceOnceLiteral(text, from, to)
  }

  for (const fragment of KNOWLEDGE_FINAL_HYGIENE_REMOVE_ONCE_BY_FILE[fileName] || []) {
    text = replaceOnceLiteral(text, fragment, "")
  }

  return normalizeText(text)
}

function normalizeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl)

    if (!["http:", "https:"].includes(url.protocol)) {
      return null
    }

    url.hash = ""

    const removableParameters = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ]

    for (const parameter of removableParameters) {
      url.searchParams.delete(parameter)
    }

    /*
     * Coppie query identiche ripetute non identificano pagine diverse.
     * Manteniamo invece eventuali valori differenti dello stesso parametro.
     */
    for (const key of [...new Set(url.searchParams.keys())]) {
      const values = url.searchParams.getAll(key)
      const uniqueValues = [...new Set(values)]

      if (uniqueValues.length !== values.length) {
        url.searchParams.delete(key)

        for (const item of uniqueValues) {
          url.searchParams.append(key, item)
        }
      }
    }

    /*
     * business.tiscali.it/partitaiva aggiunge questi parametri tecnici
     * alla stessa pagina anche tramite redirect. Non rappresentano
     * documenti Knowledge distinti.
     */
    const isBusinessPartitaIva =
      url.hostname.toLowerCase() === "business.tiscali.it" &&
      (url.pathname === "/partitaiva" ||
        url.pathname === "/partitaiva/")

    if (isBusinessPartitaIva) {
      const sectValues = url.searchParams.getAll("sect")

      if (
        sectValues.length > 0 &&
        sectValues.every((value) => value === "partitaiva")
      ) {
        url.searchParams.delete("sect")
      }

      const caseValues = url.searchParams.getAll("case")

      if (
        caseValues.length > 0 &&
        caseValues.every((value) => value === "1")
      ) {
        url.searchParams.delete("case")
      }
    }

    if (/\/index\.html$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(
        /\/index\.html$/i,
        "/",
      )
    }

    if (url.pathname !== "/") {
      while (url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1)
      }
    }

    return url.href
  } catch {
    return null
  }
}

/*
 * Forma canonica: nessuno slash finale sui path non-root.
 * Durante la transizione riconosciamo anche la precedente variante
 * con slash finale, evitando la creazione di duplicati.
 */
function equivalentPageUrls(value) {
  const canonical = normalizeUrl(value, value)

  if (!canonical) {
    return [value]
  }

  const variants = new Set([canonical])
  const parsed = new URL(canonical)

  if (parsed.pathname !== "/") {
    const legacySlash = new URL(canonical)
    legacySlash.pathname = legacySlash.pathname + "/"
    variants.add(legacySlash.href)

    /*
     * Alcuni URL storici differiscono dalla pagina corrente soltanto per
     * un separatore '-' rimasto in coda allo slug. Se una di queste forme
     * e' gia' una tombstone ARCHIVED, la forma corretta deve essere trattata
     * come la stessa identita' logica e non ricreata come documento ACTIVE.
     * La regola e' strutturale sull'URL, non dipende da titolo o servizio.
     */
    const cleanPath = parsed.pathname.replace(/-+$/, "")
    if (cleanPath && cleanPath !== parsed.pathname) {
      const withoutTrailingSeparator = new URL(canonical)
      withoutTrailingSeparator.pathname = cleanPath
      variants.add(withoutTrailingSeparator.href)
    } else {
      const withLegacyTrailingSeparator = new URL(canonical)
      withLegacyTrailingSeparator.pathname = parsed.pathname + "-"
      variants.add(withLegacyTrailingSeparator.href)
    }
  }

  return [...variants]
}

function shouldIgnoreUrl(url) {
  const parsed = new URL(url)
  const pathName = parsed.pathname.toLowerCase()

  /*
   * Endpoint tecnico usato dalle pagine Mobile per generare documenti.
   * Non è una pagina HTML della Knowledge e restituisce HTTP 500
   * se interrogato direttamente dal crawler.
   */
  if (pathName === "/mobile/pdf") {
    return true
  }

  const ignoredExtensions = [
    ".7z",
    ".avi",
    ".css",
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".m4a",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rar",
    ".svg",
    ".tar",
    ".tif",
    ".tiff",
    ".wav",
    ".webm",
    ".webp",
    ".xls",
    ".xlsx",
    ".xml",
    ".zip",
  ]

  if (ignoredExtensions.some((extension) => pathName.endsWith(extension))) {
    return true
  }

  if (
    /^\/informazioni\/supporto\/guida\/archivio-obiettivi-resoconti-\d{4}\/?$/.test(
      pathName,
    )
  ) {
    return true
  }

  const ignoredSegments = [
    "/login",
    "/logout",
    "/privacy",
    "/cookie",
    "/cookies",
    "/newsletter",
    "/feed",
    "/rss",
    "/wp-admin",
    "/wp-login",
    "/comunicazioni/",
    "/trasparenza/",
    "/trasparenza_tariffaria/",
    "/trasparenza-tariffaria/",
    "/archivio/",
    "/archive/",
    "/news/",
    "/media/",
    "/press/",
    "/stampa/",
    "/offerte-non-piu-sottoscrivibili/",
    "/offerte_non_piu_sottoscrivibili/",
  ]

  return ignoredSegments.some((segment) => pathName.includes(segment))
}

function buildFileId(url) {
  return `web-${createHash("sha256")
    .update(url)
    .digest("hex")
    .slice(0, 32)}`
}

function buildContentHash(chunks) {
  return createHash("sha256")
    .update(
      chunks
        .map((chunk) => normalizeText(chunk))
        .filter(Boolean)
        .join("\n\n"),
      "utf8",
    )
    .digest("hex")
}

function corpusForComparison(chunks, title = "") {
  const titleKey = hygieneKey(title)
  const paragraphs = chunks
    .flatMap((chunk) => normalizeText(chunk).split(/\n{2,}/))
    .map((paragraph) => normalizeText(paragraph))
    .filter(Boolean)
    .filter((paragraph) => !titleKey || hygieneKey(paragraph) !== titleKey)

  // Alcune pagine rendono il titolo come prima riga dello stesso blocco che
  // contiene il corpus. Escludiamo anche quella sola riga iniziale: cosi' una
  // riscrittura editoriale del titolo non genera un falso UPDATE, mentre ogni
  // modifica successiva del contenuto (IBAN, parametri, istruzioni, ecc.) resta
  // rilevabile.
  if (titleKey && paragraphs.length > 0) {
    const firstLines = paragraphs[0]
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)

    if (firstLines.length > 1 && hygieneKey(firstLines[0]) === titleKey) {
      paragraphs[0] = firstLines.slice(1).join("\n")
    }
  }

  return paragraphs.filter(Boolean).join("\n\n")
}

function buildCorpusHash(chunks, title = "") {
  return createHash("sha256")
    .update(corpusForComparison(chunks, title), "utf8")
    .digest("hex")
}

function corpusDifferencePreview(previousCorpus = "", nextCorpus = "", radius = 260) {
  const previous = normalizeText(previousCorpus)
  const next = normalizeText(nextCorpus)

  if (!previous && !next) {
    return { previous: null, next: null }
  }

  let index = 0
  const limit = Math.min(previous.length, next.length)
  while (index < limit && previous[index] === next[index]) index += 1

  const start = Math.max(0, index - radius)
  const previousEnd = Math.min(previous.length, index + radius)
  const nextEnd = Math.min(next.length, index + radius)

  const excerpt = (value, end) => {
    if (!value) return null
    const prefix = start > 0 ? "…" : ""
    const suffix = end < value.length ? "…" : ""
    return `${prefix}${value.slice(start, end).trim()}${suffix}` || null
  }

  return {
    previous: excerpt(previous, previousEnd),
    next: excerpt(next, nextEnd),
  }
}

function buildVirtualFileName(url) {
  const parsed = new URL(url)

  let name = parsed.pathname
    .replace(/\/index\.(html?|php)$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9À-ÿ_-]+/g, "-")
    .replace(/-+/g, "-")

  if (!name) {
    name = parsed.hostname.replace(/\./g, "-")
  }

  return `${name}.html`
}

function splitTextIntoChunks(text, maxLength = CHUNK_SIZE) {
  const normalized = normalizeText(text)

  if (!normalized) {
    return []
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const chunks = []
  let currentChunk = ""

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk)
        currentChunk = ""
      }

      for (let index = 0; index < paragraph.length; index += maxLength) {
        chunks.push(paragraph.slice(index, index + maxLength).trim())
      }

      continue
    }

    const candidate = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph

    if (candidate.length <= maxLength) {
      currentChunk = candidate
    } else {
      chunks.push(currentChunk)
      currentChunk = paragraph
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks.filter(Boolean)
}

function trimLeadingShellByVisibleHeading(value = "", visibleHeading = "") {
  const text = normalizeText(value)
  const headingKey = hygieneKey(visibleHeading)

  if (!text || !headingKey) {
    return text
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  let anchorParagraph = -1
  let anchorLine = -1

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex]

    if (hygieneKey(paragraph) === headingKey) {
      anchorParagraph = paragraphIndex
      anchorLine = 0
      continue
    }

    const lines = paragraph
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (hygieneKey(lines[lineIndex]) === headingKey) {
        anchorParagraph = paragraphIndex
        anchorLine = lineIndex
      }
    }
  }

  if (anchorParagraph < 0) {
    return text
  }

  const kept = paragraphs.slice(anchorParagraph)

  if (anchorLine > 0 && kept.length > 0) {
    const firstLines = kept[0]
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .slice(anchorLine)

    kept[0] = firstLines.join("\n")
  }

  return normalizeText(kept.filter(Boolean).join("\n\n"))
}

function nodeTagName(node) {
  return String(node?.tagName || node?.name || "").toLowerCase()
}

function internalHtmlLinkTarget($, anchor, pageUrl = "") {
  const href = normalizeText($(anchor).attr("href") || "")

  if (!href || /^(?:#|mailto:|tel:|javascript:)/i.test(href)) {
    return null
  }

  try {
    const current = new URL(pageUrl)
    const target = new URL(href, current)

    if (target.origin !== current.origin) {
      return null
    }

    // Download e risorse documentali sono contenuto utile, non navigazione.
    if (/\.(?:pdf|zip|docx?|xlsx?|pptx?|csv|txt|jpe?g|png|gif|webp)(?:$|[?#])/i.test(target.pathname)) {
      return null
    }

    return target
  } catch {
    return null
  }
}

function isStandaloneInternalHtmlLink($, node, pageUrl = "") {
  const tagName = nodeTagName(node)

  if (!["p", "li", "dt", "dd"].includes(tagName)) {
    return false
  }

  const element = $(node)
  const anchors = element.find("a").toArray()

  if (anchors.length !== 1) {
    return false
  }

  const withoutLinks = element.clone()
  withoutLinks.find("a").remove()

  // Il blocco deve essere composto esclusivamente dal link. Se contiene testo
  // istruttivo insieme al link, quel testo resta corpus informativo.
  if (normalizeText(withoutLinks.text())) {
    return false
  }

  return Boolean(internalHtmlLinkTarget($, anchors[0], pageUrl))
}

function isBackwardNavigationLabel(value = "") {
  const key = hygieneKey(value)
  return /^(?:torna|ritorna|indietro|back)(?:\s|$)/.test(key)
}

function isTerminalNavigationParagraph(value = "") {
  const key = hygieneKey(value)
  if (!key || !isBackwardNavigationLabel(key)) return false

  // Una vera istruzione operativa non va mai eliminata solo perche' inizia
  // con "torna". I verbi operativi proteggono questi casi.
  if (/(?:^|\s)(?:clicca|premi|seleziona|inserisci|digita|salva|configura|attendi|verifica|accedi|imposta|attiva|disattiva)(?:\s|$)/.test(key)) {
    return false
  }

  const words = key.split(/\s+/).filter(Boolean)
  if (words.length > 14) return false

  return /(?:^|\s)(?:indice|elenco|menu|guida|pagina|sezione|home|funzionalita|video)(?:\s|$)/.test(key)
}

function textFromStructuredNode($, node, pageUrl = "") {
  const element = $(node).clone()
  const tagName = nodeTagName(node)

  if (!["p", "li", "dt", "dd"].includes(tagName)) {
    return normalizeText(element.text())
  }

  const anchors = element.find("a").toArray()
  const lastAnchor = anchors.at(-1)

  if (!lastAnchor || !internalHtmlLinkTarget($, lastAnchor, pageUrl)) {
    return normalizeText(element.text())
  }

  const fullText = normalizeText(element.text())
  const linkText = normalizeText($(lastAnchor).text())

  // Alcuni template inseriscono il link di ritorno dentro lo stesso <p>
  // dell'ultima istruzione. Lo rimuoviamo solo quando e' davvero l'ultima
  // porzione testuale del blocco ed e' semanticamente una navigazione di
  // ritorno. I normali link interni inseriti nelle istruzioni restano intatti.
  if (
    linkText &&
    fullText.endsWith(linkText) &&
    isBackwardNavigationLabel(linkText)
  ) {
    $(lastAnchor).remove()
  }

  return normalizeText(element.text())
}

function structuredTextFromElements($, elements, pageUrl = "") {
  const nodes = elements
    .find("h1, h2, h3, h4, h5, h6, p, li, dt, dd, table")
    .toArray()

  // Rimuoviamo soltanto elementi terminali puramente strutturali:
  // - heading h2-h6 senza contenuto successivo;
  // - blocchi composti esclusivamente da un link HTML interno.
  // Non dipende dal testo del link, dal servizio, dal modem o dall'URL specifico.
  while (nodes.length > 0) {
    const lastNode = nodes[nodes.length - 1]

    if (/^h[2-6]$/.test(nodeTagName(lastNode))) {
      nodes.pop()
      continue
    }

    if (isStandaloneInternalHtmlLink($, lastNode, pageUrl)) {
      nodes.pop()
      continue
    }

    break
  }

  return normalizeText(
    nodes
      .map((node) => textFromStructuredNode($, node, pageUrl))
      .filter(Boolean)
      .join("\n\n"),
  )
}

function extractPage($, pageUrl, renderedText = "") {
  $(
    [
      "script", "style", "noscript", "template", "svg", "canvas",
      "iframe", "form", "nav", "footer", "[aria-hidden='true']",
      ".cookie", ".cookies", ".cookie-banner", ".breadcrumb",
      ".breadcrumbs", ".menu", ".navigation", ".newsletter",
      ".social", ".share",
    ].join(","),
  ).remove()

  // L'heading visibile e' l'ancora strutturale del corpus. Va tenuto separato
  // dal titolo persistito, che puo' essere riscritto editorialmente senza che
  // il contenuto informativo della pagina sia cambiato.
  const visibleHeading = normalizeText($("h1").first().text())
  const title = normalizeText(
    visibleHeading ||
      $("meta[property='og:title']").attr("content") ||
      $("title").first().text() ||
      pageUrl,
  )

  const description = normalizeText(
    $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      "",
  )

  // Preferiamo il primo contenitore semantico sufficientemente completo.
  // Non scegliamo piu' il contenitore piu' lungo: un wrapper esterno puo'
  // contenere menu, navigazione e altre pagine pur essendo piu' grande.
  const semanticSelectors = [
    "main", "article", "[role='main']", "#content", ".page-content",
    ".entry-content", ".article-content", ".content",
  ]

  let content = ""
  let bestSemanticFallback = ""

  for (const selector of semanticSelectors) {
    const elements = $(selector)

    if (!elements.length) {
      continue
    }

    const candidate = structuredTextFromElements($, elements, pageUrl)

    if (candidate.length > bestSemanticFallback.length) {
      bestSemanticFallback = candidate
    }

    if (candidate.length >= MIN_CONTENT_LENGTH) {
      content = candidate
      break
    }
  }

  if (!content) {
    content = bestSemanticFallback
  }

  // .container e body sono fallback, non sorgenti preferenziali.
  if (content.length < MIN_CONTENT_LENGTH) {
    const containerCandidate = structuredTextFromElements($, $(".container"), pageUrl)
    if (containerCandidate.length > content.length) {
      content = containerCandidate
    }
  }

  if (content.length < MIN_CONTENT_LENGTH) {
    const bodyCandidate = structuredTextFromElements($, $("body"), pageUrl)
    if (bodyCandidate.length > content.length) {
      content = bodyCandidate
    }
  }

  content = trimLeadingShellByVisibleHeading(content, visibleHeading)

  // page.content() contiene gia' il DOM renderizzato delle pagine dinamiche.
  // innerText resta solo un fallback se il DOM strutturato non contiene un
  // corpus sufficiente; non puo' piu' sostituirlo solo perche' e' piu' lungo.
  if (content.length < MIN_CONTENT_LENGTH) {
    const renderedCandidate = trimLeadingShellByVisibleHeading(
      normalizeText(renderedText),
      visibleHeading,
    )

    if (renderedCandidate.length > content.length) {
      content = renderedCandidate
    }
  }

  return { title, description, content }
}

function categoryForSource(source) {
  if (source.type === "faq") {
    return "FAQ"
  }

  if (source.type === "commercial") {
    return "COMMERCIAL"
  }

  return "GENERAL"
}

function tagsForPage(source, url, title) {
  const hostname = new URL(url).hostname

  return [...new Set(["web", hostname, source.name, source.type, title].filter(Boolean))]
    .join(", ")
    .slice(0, 1000)
}

async function fetchStaticPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "it-IT,it;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; LiaKnowledgeImporter/1.0)",
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const contentType = response.headers.get("content-type") || ""

  if (!contentType.toLowerCase().includes("text/html")) {
    return null
  }

  const html = await response.text()
  const finalUrl =
    normalizeUrl(response.url, url) || url

  let finalHostname = ""

  try {
    finalHostname =
      new URL(finalUrl).hostname.toLowerCase()
  } catch {
    finalHostname = ""
  }

  const isRadwareCaptcha =
    finalHostname === "validate.perfdrive.com" ||
    /<title[^>]*>\s*Radware Captcha Page\s*<\/title>/i.test(
      html,
    )

  if (isRadwareCaptcha) {
    throw new Error(
      `Sorgente temporaneamente bloccata da Radware: ${url}. Contenuti Knowledge precedenti conservati.`,
    )
  }

  return {
    html,
    finalUrl,
    renderedText: "",
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0
      const distance = 700
      const maximumScrolls = 30
      let scrollCount = 0

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight

        window.scrollBy(0, distance)
        totalHeight += distance
        scrollCount += 1

        if (totalHeight >= scrollHeight || scrollCount >= maximumScrolls) {
          clearInterval(timer)
          window.scrollTo(0, 0)
          resolve()
        }
      }, 120)
    })
  })
}

async function extractRenderedText(page) {
  const selectors = [
    "main", "article", "[role='main']", "#content", ".content",
    ".page-content", ".entry-content", ".article-content",
  ]

  let bestText = ""

  for (const selector of selectors) {
    const locator = page.locator(selector)

    if ((await locator.count()) === 0) {
      continue
    }

    const texts = await locator.allInnerTexts()
    const candidate = normalizeText(texts.join("\n\n"))

    if (candidate.length > bestText.length) {
      bestText = candidate
    }
  }

  if (bestText.length < MIN_CONTENT_LENGTH) {
    bestText = normalizeText(await page.locator("body").innerText())
  }

  return bestText
}

async function fetchDynamicPage(context, url) {
  if (!context) {
    throw new Error(
      `La pagina ${url} richiede il browser dinamico, ma Playwright non è stato inizializzato.`,
    )
  }

  const page = await context.newPage()

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })

    if (response && !response.ok()) {
      throw new Error(`HTTP ${response.status()}`)
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 8_000 })
    } catch {
      // Alcune pagine mantengono connessioni aperte.
    }

    await page.waitForTimeout(DYNAMIC_WAIT_MS)
    await autoScroll(page)
    await page.waitForTimeout(DYNAMIC_WAIT_MS)

    const finalUrl = normalizeUrl(page.url(), url) || url
    const renderedText = await extractRenderedText(page)
    const html = await page.content()

    return { html, finalUrl, renderedText }
  } finally {
    await page.close()
  }
}

async function fetchPage(context, url) {
  const hostname = new URL(url).hostname.toLowerCase()

  if (DYNAMIC_HOSTNAMES.has(hostname)) {
    return fetchDynamicPage(context, url)
  }

  return fetchStaticPage(url)
}

function deviceScopeFromUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").map((part) => part.trim()).filter(Boolean)
    const index = parts.findIndex((part) => part === "modem" || part === "modem-compatibile")
    if (index < 0 || !parts[index + 1] || parts[index + 1] === "guida") return null
    return decodeURIComponent(parts[index + 1]).replace(/-/g, " ").replace(/\s+/g, " ").trim() || null
  } catch {
    return null
  }
}

function semanticKey(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function semanticHas(text, values) {
  const haystack = ` ${semanticKey(text)} `
  return values.some((value) => {
    const needle = semanticKey(value)
    return needle && haystack.includes(` ${needle} `)
  })
}

function importedPageClassification(source, pageUrl, page) {
  let pathname = ""
  let hostname = ""
  try {
    const parsed = new URL(pageUrl)
    pathname = parsed.pathname.toLowerCase()
    hostname = parsed.hostname.toLowerCase()
  } catch {
    // URL gia' validato dal crawler; fallback prudenziale sui soli contenuti.
  }

  const pathText = pathname.replace(/[-_/]+/g, " ")
  const identityText = [page.title, page.description, pathText]
    .filter(Boolean)
    .join(" ")
  const leadText = [identityText, String(page.content || "").slice(0, 900)]
    .filter(Boolean)
    .join(" ")

  /*
   * Casa e Business sono il catalogo commerciale corrente. Il flusso
   * commerciale dedicato e' l'unica fonte per offerte/prezzi acquistabili:
   * il WEB_SYNC conserva queste pagine come tombstone ARCHIVED per evitare
   * che entrino nel ranking Knowledge generale di Lia, anche quando sono nuove.
   */
  if (source.type === "web") {
    const serviceType =
      pathname.includes("/mobile") ||
      semanticHas(identityText, ["mobile", "sim", "esim", "5g", "4g"])
        ? "MOBILE"
        : semanticHas(identityText, ["fibra", "ftth", "fttc", "adsl", "internet casa", "linea fissa"])
          ? "FIXED_NETWORK"
          : "ADMINISTRATIVE"

    return {
      serviceType,
      assistanceArea: "COMMERCIAL",
      topic: "OFFERS",
      customerType:
        hostname === "business.tiscali.it" || semanticHas(source.name, ["business"])
          ? "BUSINESS"
          : null,
      status: "ARCHIVED",
    }
  }

  const fixedManual =
    pathname.startsWith("/internet-telefono/modem/") ||
    pathname.startsWith("/internet-telefono/modem-compatibile/")

  if (fixedManual) {
    return {
      serviceType: "FIXED_NETWORK",
      assistanceArea: "TECHNICAL",
      topic: "CONFIGURATION_GUIDE",
      customerType: null,
      status: "ACTIVE",
    }
  }

  let serviceType = "OTHER"

  if (
    pathname.startsWith("/mobile/") ||
    pathname.startsWith("/domande-frequenti/mobile-") ||
    pathname.startsWith("/modulistica/moduli-tiscali-mobile")
  ) {
    serviceType = "MOBILE"
  } else if (
    pathname.startsWith("/internet-telefono/") ||
    pathname.startsWith("/domande-frequenti/telefono-fisso") ||
    pathname.startsWith("/domande-frequenti/internet") ||
    pathname.startsWith("/domande-frequenti/attivazione-internet-telefono") ||
    pathname.startsWith("/modulistica/moduli-number-portability")
  ) {
    serviceType = "FIXED_NETWORK"
  } else if (
    pathname.startsWith("/servizi/tiscali-mail/") ||
    pathname.startsWith("/servizi/katamail/") ||
    pathname.startsWith("/servizi/guida/posta-") ||
    semanticHas(identityText, [
      "tiscali mail",
      "katamail",
      "casella email",
      "casella di posta",
      "posta elettronica",
      "webmail",
      "imap",
      "smtp",
    ])
  ) {
    serviceType = "EMAIL"
  } else if (
    pathname.startsWith("/supporto/moduli/servizi/hosting_domini/") ||
    pathname.startsWith("/modulistica/moduli-domini") ||
    pathname.startsWith("/domande-frequenti/domini") ||
    semanticHas(identityText, [
      "dominio web",
      "domini web",
      "hosting",
      "authinfo",
      "authorization code",
      "dns",
    ])
  ) {
    serviceType = "DOMAINS"
  } else if (
    pathname.startsWith("/informazioni/contratto") ||
    pathname.startsWith("/modulistica/moduli-modifiche-contrattuali") ||
    pathname.startsWith("/modulistica/moduli-richieste-amministrative")
  ) {
    serviceType = "ADMINISTRATIVE"
  } else if (
    semanticHas(identityText, [
      "tiscali mobile",
      "sim tiscali",
      "codice puk",
      "credito mobile",
      "ricarica mobile",
      "roaming",
    ])
  ) {
    serviceType = "MOBILE"
  } else if (
    semanticHas(identityText, [
      "fibra",
      "ftth",
      "fttc",
      "adsl",
      "modem",
      "router",
      "linea fissa",
      "telefono fisso",
    ])
  ) {
    serviceType = "FIXED_NETWORK"
  } else if (
    semanticHas(identityText, [
      "fattura",
      "bolletta",
      "pagamento",
      "rimborso",
      "contratto",
      "intestatario",
      "disdetta",
      "recesso",
      "modulistica",
    ])
  ) {
    serviceType = "ADMINISTRATIVE"
  } else if (
    semanticHas(leadText, [
      "casella di posta",
      "posta elettronica",
      "tiscali mail",
      "katamail",
    ])
  ) {
    serviceType = "EMAIL"
  }

  if (serviceType === "OTHER") {
    return {
      serviceType: "OTHER",
      assistanceArea: "FAQ",
      topic: "FAQ_GENERAL",
      customerType: null,
      status: "ACTIVE",
    }
  }

  let assistanceArea = "TECHNICAL"

  const administrativeSignal = semanticHas(identityText, [
    "fattura",
    "bolletta",
    "pagamento",
    "rimborso",
    "ricarica",
    "credito residuo",
    "domiciliazione",
    "scadenza",
    "rinnovo dominio",
  ])
  const contractChangeSignal = semanticHas(identityText, [
    "cambio intestatario",
    "variazione intestatario",
    "modifica dati contratto",
    "variazioni contrattuali",
    "variazione contrattuale",
    "modifica contrattuale",
    "disdetta",
    "recesso",
    "disattivazione servizi",
    "trasloco",
    "cambio profilo",
    "cambio segmento",
  ])
  const activationSignal = semanticHas(identityText, [
    "attivazione",
    "attivare nuova linea",
    "portabilita",
    "number portability",
    "acquisto sim",
    "sostituzione sim",
    "nuova sim",
    "nuova casella",
  ])
  const offerSignal = semanticHas(identityText, [
    "offerta",
    "offerte",
    "tariffa",
    "tariffe",
    "profilo tariffario",
  ])

  if (serviceType === "ADMINISTRATIVE") {
    assistanceArea =
      contractChangeSignal || semanticHas(identityText, ["contratto", "condizioni contrattuali", "privacy contrattuale"])
        ? "COMMERCIAL"
        : activationSignal
          ? "ACTIVATION"
          : "ADMINISTRATIVE"
  } else if (serviceType === "EMAIL") {
    assistanceArea = semanticHas(identityText, [
      "attivazione casella",
      "attivazione email",
      "nuova casella",
      "cessazione casella",
      "disattivazione casella",
      "cessazione servizio email",
    ])
      ? "COMMERCIAL"
      : "TECHNICAL"
  } else if (serviceType === "DOMAINS") {
    assistanceArea = administrativeSignal
      ? "ADMINISTRATIVE"
      : contractChangeSignal || activationSignal || offerSignal
        ? "COMMERCIAL"
        : "TECHNICAL"
  } else if (administrativeSignal) {
    assistanceArea = "ADMINISTRATIVE"
  } else if (contractChangeSignal || activationSignal || offerSignal) {
    assistanceArea = "COMMERCIAL"
  }

  let topic = null

  if (assistanceArea === "ADMINISTRATIVE") {
    if (serviceType === "DOMAINS") {
      topic = semanticHas(identityText, ["rinnovo", "scadenza"])
        ? "DOMAIN_RENEWAL"
        : "DOMAIN_INVOICE"
    } else if (serviceType === "ADMINISTRATIVE") {
      if (semanticHas(identityText, ["fattura", "bolletta"])) {
        topic = "INVOICE_INFO"
      } else if (semanticHas(identityText, ["disdetta", "recesso", "variazione contrattuale", "modifica contrattuale"])) {
        topic = "TERMINATION_OR_CONTRACT_CHANGE"
      } else {
        topic = "PAYMENTS_AND_TOPUPS"
      }
    } else if (semanticHas(identityText, ["fattura", "bolletta"])) {
      topic = "INVOICE_INFO"
    } else if (semanticHas(identityText, ["rimborso"])) {
      topic = "REFUND_INFO"
    } else {
      topic = serviceType === "MOBILE" ? "PAYMENTS_AND_TOPUPS" : "PAYMENT_INFO"
    }
  } else if (assistanceArea === "ACTIVATION") {
    topic = "ACTIVATION_INFO"
  } else if (assistanceArea === "COMMERCIAL") {
    if (serviceType === "EMAIL") {
      topic = semanticHas(identityText, ["cessazione", "disattivazione"])
        ? "EMAIL_TERMINATION"
        : "EMAIL_ACTIVATION"
    } else if (serviceType === "DOMAINS") {
      topic = contractChangeSignal
        ? "DOMAIN_TERMINATION_OR_CHANGE"
        : activationSignal
          ? "DOMAIN_ACTIVATION"
          : "DOMAIN_OFFERS"
    } else if (semanticHas(identityText, ["cambio intestatario", "variazione intestatario"])) {
      topic = "CHANGE_ACCOUNT_HOLDER"
    } else if (contractChangeSignal) {
      topic = "TERMINATION_OR_CONTRACT_CHANGE"
    } else if (semanticHas(identityText, ["condizioni contrattuali", "privacy contrattuale", "carta dei servizi"])) {
      topic = "CONTRACT_TERMS"
    } else if (offerSignal) {
      topic = "OFFERS"
    } else {
      topic = "ACTIVATION_INFO"
    }
  } else if (serviceType === "EMAIL") {
    if (semanticHas(identityText, ["password", "accesso", "autenticazione", "login", "bad request"])) {
      topic = "EMAIL_ACCESS"
    } else if (
      pathname.startsWith("/servizi/guida/posta-") ||
      semanticHas(identityText, ["configurazione", "configura", "parametri", "imap", "smtp", "pop3"])
    ) {
      topic = "EMAIL_CONFIGURATION"
    } else if (semanticHas(identityText, ["invio", "invia", "ricezione", "ricevi", "inoltro", "messaggi"])) {
      topic = "EMAIL_SEND_RECEIVE"
    } else {
      topic = "EMAIL_OTHER"
    }
  } else if (serviceType === "DOMAINS") {
    if (semanticHas(identityText, ["dns"])) {
      topic = "DOMAIN_DNS"
    } else if (semanticHas(identityText, ["trasferimento", "authinfo", "authorization code"])) {
      topic = "DOMAIN_TRANSFER"
    } else if (semanticHas(identityText, ["non raggiungibile", "irraggiungibile"])) {
      topic = "DOMAIN_UNREACHABLE"
    } else {
      topic = "DOMAIN_OTHER"
    }
  } else {
    const malfunctionSignal = semanticHas(identityText, [
      "problema",
      "problemi",
      "malfunzionamento",
      "non funziona",
      "impossibile",
      "errore",
      "lentezza",
      "disconnessione",
    ])

    if (malfunctionSignal && semanticHas(identityText, ["chiamate", "telefonate", "voce"])) {
      topic = "CALLS_MALFUNCTION"
    } else if (malfunctionSignal && semanticHas(identityText, ["internet", "navigazione", "connessione", "fibra", "adsl", "dati mobili"])) {
      topic = "INTERNET_MALFUNCTION"
    } else if (malfunctionSignal && semanticHas(identityText, ["segreteria", "trasferimento chiamata", "avviso di chiamata", "servizi aggiuntivi"])) {
      topic = "ADDITIONAL_SERVICES_MALFUNCTION"
    } else {
      topic = "CONFIGURATION_GUIDE"
    }
  }

  const hasBusinessCustomer = semanticHas(leadText, [
    "partita iva",
    "cliente business",
    "clienti business",
    "azienda",
    "imprese",
  ])
  const hasPrivateCustomer = semanticHas(leadText, [
    "cliente privato",
    "clienti privati",
  ])
  const customerType = hasBusinessCustomer === hasPrivateCustomer
    ? null
    : hasBusinessCustomer
      ? "BUSINESS"
      : "PRIVATE"

  return {
    serviceType,
    assistanceArea,
    topic,
    customerType,
    status: topic === "OFFERS" || topic === "DOMAIN_OFFERS"
      ? "ARCHIVED"
      : "ACTIVE",
  }
}




export function normalizeImportedUrl(value, baseUrl) {
  return normalizeUrl(value, baseUrl);
}

export function equivalentImportedUrls(value) {
  return equivalentPageUrls(value);
}

export function shouldIgnoreImportedUrl(value) {
  try {
    return shouldIgnoreUrl(value);
  } catch {
    return true;
  }
}

export function buildImportedVirtualFileName(value) {
  return buildVirtualFileName(value);
}

export function buildImportedCorpusHashFromContent(content, title = "") {
  const chunks = splitTextIntoChunks(content || "");
  return buildCorpusHash(chunks, title || "");
}

export function prepareImportedKnowledgePage(source, pageUrl, html, renderedText = "") {
  const $ = cheerio.load(String(html || ""));
  let page = extractPage($, pageUrl, renderedText);
  const fileName = buildVirtualFileName(pageUrl);

  const links = [];
  $("a[href]").each((_, element) => {
    const linkedUrl = normalizeUrl($(element).attr("href"), pageUrl);
    if (!linkedUrl || shouldIgnoreUrl(linkedUrl)) return;
    links.push(linkedUrl);
  });

  if (/\uFFFD/.test(String(page.content || ""))) {
    return { ignored: true, reason: "invalid-encoding", links: [...new Set(links)] };
  }

  if (!shouldStoreKnowledgePage(source, pageUrl, page)) {
    return { ignored: true, reason: "hygiene-page", links: [...new Set(links)] };
  }

  if (containsObsoletePaymentReference(page.content)) {
    return { ignored: true, reason: "obsolete-payment-reference", links: [...new Set(links)] };
  }

  const title = persistentImportedTitle(
    fileName,
    sanitizeImportedScalar(page.title || ""),
  );
  const content = applyPersistentKnowledgeHygiene(
    fileName,
    sanitizeImportedContent(page.content || "", title),
  );
  const description = persistentImportedDescription(
    fileName,
    descriptionForImportedPage(
      { ...page, title, content },
      source,
    ),
  );

  page = { ...page, title, description, content };

  const nonInformativeShell = isNonInformativeAssistanceShell(
    pageUrl,
    page.content,
  );
  const chunks = splitTextIntoChunks(page.content);
  validateImportedChunks(chunks);

  if (!chunks.length) {
    return { ignored: true, reason: "empty-corpus", links: [...new Set(links)] };
  }

  const classification = importedPageClassification(source, pageUrl, page);
  const documentData = {
    title: page.title.slice(0, 500),
    description: page.description
      ? page.description.slice(0, 2000)
      : `Pagina importata da ${source.name}`,
    category: categoryForSource(source),
    department: null,
    version: "1.0",
    tags: tagsForPage(source, pageUrl, page.title),
    fileId: buildFileId(pageUrl),
    fileName,
    fileSize: Buffer.byteLength(page.content, "utf8"),
    fileType: "text/html",
    fileUrl: pageUrl,
    sourceType: "WEB_SYNC",
    deviceScope: deviceScopeFromUrl(pageUrl),
    serviceType: classification.serviceType,
    assistanceArea: classification.assistanceArea,
    topic: classification.topic,
    customerType: classification.customerType,
    targetStatus: classification.status,
  };

  return {
    ignored: false,
    reason: null,
    page,
    links: [...new Set(links)],
    chunks,
    documentData,
    classification,
    nonInformativeShell,
    contentHash: buildContentHash(chunks),
    corpus: corpusForComparison(chunks, documentData.title),
    corpusHash: buildCorpusHash(chunks, documentData.title),
  };
}

export const KNOWLEDGE_INGEST_REVISION = "lia-final-hygiene-v2.4";
