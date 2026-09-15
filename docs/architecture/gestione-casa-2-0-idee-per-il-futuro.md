# Implementazione Gestione Casa 2.0 — Idee per il futuro

**Data:** 15 settembre 2026  
**Stato:** Documento di indirizzo architetturale e di prodotto  
**Ambito:** evoluzione futura da Gestione Casa OCR a Gestione Casa 2.0  
**Nota vincolante:** questo documento NON introduce ora funzionalità Family/Family Plus nella beta Gestione Casa OCR. Serve a preservare le fondamenta e le decisioni emerse, affinché Gestione Casa OCR possa diventare la base tecnica di Gestione Casa 2.0 senza riscritture inutili.

---

## 1. Premessa e separazione delle versioni

Gestione Casa OCR è la versione beta attuale, pensata per un singolo utilizzatore. Il lavoro corrente deve rimanere concentrato sulla stabilizzazione dell'OCR, sulla revisione degli scontrini, sulla persistenza locale, sul catalogo prodotti e sull'esperienza utente.

Le funzioni multi-licenza, Family e Family Plus appartengono invece a **Gestione Casa 2.0**, che dovrà essere considerata una nuova versione/prodotto evolutivo e non un semplice upgrade della beta.

L'obiettivo attuale non è implementare anticipatamente Gestione Casa 2.0, ma verificare che l'architettura di Gestione Casa OCR non chiuda la strada all'evoluzione futura.

---

## 2. Principio guida: "Tutto è local, nulla è public"

La filosofia di Gestione Casa deve essere la massima riservatezza possibile.

### Principio architetturale

> **Gestione Casa non invia nessun dato personale, economico o documentale dell'utente a server esterni.**
>
> I dati restano locali sui dispositivi dell'utente e, nelle future versioni Family/Family Plus, possono essere condivisi esclusivamente per scelta esplicita dell'utente all'interno del proprio nucleo familiare o gruppo autorizzato.
>
> **Tutto è local, nulla è public.**

Questo principio deve valere per:

- entrate;
- uscite;
- scontrini;
- fatture e documenti;
- contratti;
- fornitori;
- catalogo prodotti;
- progetti di risparmio;
- allegati;
- note;
- dati OCR;
- diagnostica OCR;
- backup applicativi.

Nessuno di questi dati deve essere inviato automaticamente a infrastrutture centrali Gestione Casa.

---

## 3. Separazione totale tra licenza e dati dell'utente

Il sistema commerciale/licenze e il contenuto privato dell'app devono essere due domini tecnicamente separati.

### Sistema commerciale/licenze

Può contenere esclusivamente ciò che serve per vendita, licenza, assistenza e fatturazione, ad esempio:

- nome e cognome;
- eventuale indirizzo di fatturazione;
- indirizzo e-mail;
- numero/licenza acquistata;
- stato della licenza;
- dispositivi autorizzati secondo il piano acquistato;
- riferimenti tecnici della transazione necessari alla gestione commerciale.

Il pagamento viene gestito tramite **Stripe**. Gestione Casa non deve ricevere o conservare il numero completo della carta di credito dell'utente.

### Dati privati Gestione Casa

Il sistema di licenze NON deve permettere di ricavare:

- contenuto dell'app;
- password o PIN locali;
- chiavi di cifratura;
- recovery key;
- dati economici;
- documenti archiviati;
- Family Drive;
- backup cifrati.

### Regola fondamentale

> **La licenza identifica il diritto a usare Gestione Casa. Non identifica e non sblocca i dati contenuti in Gestione Casa.**

Compromettere il sistema licenze non deve compromettere il patrimonio informativo dell'utente.

---

## 4. Recupero licenza e recupero dati sono due cose diverse

Gestione Casa potrà assistere l'utente nel recupero del diritto d'uso, ad esempio:

- recuperare il numero di licenza;
- verificare l'acquisto;
- disassociare un dispositivo non più disponibile secondo le regole previste;
- consentire una nuova attivazione.

Gestione Casa NON deve poter recuperare i dati privati dell'utente, perché tali dati non vengono conservati sui sistemi Gestione Casa.

### Formula di riferimento

> **Gestione Casa può recuperare il tuo diritto d'uso, non i tuoi dati.**

Il recupero dei dati dipenderà esclusivamente dai backup conservati dall'utente o dal futuro Family Drive.

---

## 5. Copia digitale verificabile dello scontrino

L'utente finale non deve essere esposto alla complessità tecnica dell'OCR.

L'esperienza prevista è una **copia digitale verificabile** dello scontrino: una ricostruzione leggibile e ordinata del documento reale, con tutte le righe che l'utente può controllare e correggere.

### Workflow previsto

1. L'OCR elabora il documento localmente.
2. L'utente vede la copia digitale dello scontrino, non JSON, log o diagnostica.
3. I dati dubbi o mancanti possono essere corretti manualmente.
4. Ogni riga prodotto può essere verificata/modificata.
5. Solo dopo la conferma il documento passa da `pending/review` a spesa effettiva.
6. La versione confermata dall'utente diventa la fonte contabile dell'app.

### Informazioni tecniche

JSON OCR, raw text, diagnostica, confidence, varianti e metadati devono restare disponibili solo dietro una sezione volontaria del tipo:

- **Dietro le quinte**;
- **Modalità laboratorio**;
- **Informazioni tecniche**.

Lo "smanettone" potrà esportare volontariamente il JSON diagnostico. L'utente comune non dovrà mai essere costretto a vederlo.

---

## 6. Riapertura dei documenti acquisiti

I documenti acquisiti non devono essere soltanto visualizzabili o cancellabili.

Deve essere prevista la possibilità di **riaprire** un documento per:

- controllarlo;
- correggere i dati;
- modificare le righe prodotto;
- aggiornare categorie o classificazioni;
- riesaminare una spesa già acquisita secondo regole controllate.

Per i documenti ancora `pending` la riapertura può consentire modifica completa. Per i documenti già contabilizzati dovrà essere progettato un flusso di revisione che mantenga coerente il collegamento tra documento e spesa registrata.

---

## 7. Catalogo prodotti locale alimentato dalle correzioni dell'utente

Quando l'utente corregge il nome di un prodotto nella copia digitale e conferma lo scontrino, la correzione può alimentare il catalogo prodotti locale.

Esempio concettuale:

`testo OCR → nome corretto dall'utente → conferma → catalogo locale`

La registrazione nel catalogo deve avvenire preferibilmente alla conferma dello scontrino, non durante la digitazione, per evitare di memorizzare errori temporanei.

Il catalogo può conservare almeno:

- nome normalizzato;
- nome visualizzato;
- eventuali alias OCR;
- marca;
- barcode se disponibile;
- unità di misura;
- categoria;
- sottocategoria;
- metadati/versione.

L'architettura corrente possiede già `Product`, `ProductAlias`, `categoryId` e `subcategoryId`, quindi questa evoluzione è coerente con il modello esistente.

---

## 8. Categoria per singola riga prodotto

Nella futura copia digitale ogni riga prodotto potrà avere una piccola freccia/chevron discreta ma visibile che apre il catalogo delle categorie di spesa già presenti nell'app.

L'utente potrà associare il prodotto, ad esempio, a:

- alimentari;
- casalinghi;
- voluttuario;
- meccanica;
- attrezzi;
- altre categorie già previste nell'app.

La categoria scelta per la singola transazione non deve essere necessariamente bloccata per sempre sul prodotto. Il catalogo può proporre la categoria abituale, ma l'utente deve poterla cambiare per uno specifico acquisto.

In una fase successiva l'app potrà chiedere se aggiornare anche la categoria predefinita del prodotto nel catalogo locale.

---

## 9. Gestione Casa 2.0 — Family e Family Plus

### Principio

Family/Family Plus non deve significare "più persone obbligate a condividere tutto".

Deve significare:

> **fino al numero di dispositivi/utenti previsto dal piano, ciascuno autonomo, con possibilità di condividere solo ciò che decide di condividere.**

Una licenza multipla concede attivazioni. La condivisione dei dati deve essere una scelta ulteriore, separata.

### Esempio d'uso

Tre coinquilini possono:

- avere ciascuno il proprio spazio personale privato;
- creare uno spazio comune per affitto, bollette, spesa alimentare o fondo cassa;
- mantenere invisibili agli altri le spese personali;
- condividere solo determinate operazioni o documenti.

### Regola di default

> **Privato per default, condiviso solo su scelta esplicita.**

L'appartenenza allo stesso Family Plus non autorizza automaticamente l'accesso a tutti i dati degli altri membri.

---

## 10. Spazi personali e spazi condivisi

Gestione Casa 2.0 dovrà distinguere le identità/utenti dai contribuenti contabili già presenti nell'app.

I `Contributor` attuali rappresentano soggetti/entrate e non devono essere trasformati automaticamente in membri Family.

Il modello futuro dovrebbe introdurre il concetto di **Space/Vault**:

- spazio personale A;
- spazio personale B;
- spazio personale C;
- uno o più spazi condivisi opzionali, ad esempio `Casa comune`, `Spesa comune`, `Vacanze`.

Ogni record dovrà poter appartenere a uno scope equivalente a:

- `PERSONAL`;
- `SHARED`.

Concettualmente:

`Device → Member → Space → Record`

I nomi definitivi dei tipi e dei campi saranno decisi in fase di implementazione 2.0.

---

## 11. Family Drive: chiavetta USB collegata al router

L'idea preferita per la sincronizzazione domestica è utilizzare una normale chiavetta USB o altro supporto collegato a un router compatibile che lo espone sulla LAN.

La chiavetta NON esegue software. È un **drive condiviso**. Il software di sincronizzazione gira dentro Gestione Casa sui dispositivi.

### Modello

`Dispositivo A ⇄ Wi-Fi/LAN ⇄ Family Drive ⇄ Dispositivo B/C`

Nessun dispositivo deve essere "principale" o "master".

Tutti i dispositivi autorizzati devono poter essere peer equivalenti.

### Vantaggi

- nessun server cloud Gestione Casa;
- nessun mini-PC obbligatorio;
- nessun dispositivo principale indispensabile;
- dati disponibili anche se uno o più telefoni vengono persi;
- Family Drive ricostruibile da un dispositivo superstite;
- stesso supporto trasferibile su un nuovo router compatibile;
- punto neutrale di sincronizzazione tra i membri.

---

## 12. Il Family Drive non deve contenere un database condiviso aperto direttamente

Non è consigliato collocare un database Dexie/SQLite su una condivisione di rete e farlo aprire simultaneamente da più dispositivi.

Il Family Drive deve essere invece un **archivio di sincronizzazione e recupero**, con dati versionati.

Struttura concettuale possibile:

```text
/GestioneCasa/
    family-manifest.json
    /devices/
    /changes/
    /snapshots/
    /catalogo/
    /documenti-condivisi/
```

La struttura reale potrà cambiare, ma i principi devono rimanere:

- record identificabili;
- versionamento;
- provenienza dispositivo;
- timestamp;
- gestione conflitti;
- snapshot completi periodici;
- possibilità di ricostruzione.

---

## 13. Sincronizzazione locale

La sincronizzazione potrà avvenire quando l'app è aperta e il Family Drive è raggiungibile sulla LAN.

Esempio di esperienza utente:

`Apro Gestione Casa → Family Drive rilevato → confronto revisioni → import/export modifiche → sincronizzazione completata`

L'obiettivo non è necessariamente la sincronizzazione in tempo reale.

Su iOS, in particolare, non deve essere promesso un comportamento continuo in background. È sufficiente un modello affidabile di sincronizzazione all'apertura, al ritorno in foreground o tramite comando manuale.

### Metadati minimi concettuali

Ogni record sincronizzabile dovrà avere elementi equivalenti a:

- `recordId`;
- `version/revision`;
- `deviceId`;
- `updatedAt`;
- `syncStatus`;
- `spaceId` futuro;
- eventuale provenienza/autore della modifica.

---

## 14. Gestione conflitti

La parte più delicata della sincronizzazione non è il trasferimento dei file ma la gestione delle modifiche concorrenti.

Esempio: due membri cambiano nello stesso periodo la stessa voce del catalogo.

Il motore di sincronizzazione dovrà poter:

- riconoscere revisioni differenti;
- evitare overwrite ciechi;
- fondere modifiche quando sicuro;
- chiedere conferma all'utente nei conflitti reali;
- registrare l'origine delle modifiche.

Le primitive `version`, `deviceId` e `syncStatus` già presenti nel modello corrente sono una buona base, ma non costituiscono ancora un motore Family completo.

---

## 15. Backup: nessun cloud proprietario obbligatorio

Gestione Casa non deve richiedere un cloud proprietario a pagamento per i dati personali dell'utente.

L'utente deve poter esportare quando vuole un **backup cifrato completo** e conservarlo dove preferisce:

- seconda chiavetta;
- hard disk;
- NAS;
- Google Drive;
- OneDrive;
- iCloud Drive;
- Dropbox;
- spazio cloud associato a un proprio account;
- qualunque altra destinazione scelta dall'utente.

### Principio

> **Il cloud, se lo vuoi, è il tuo. Non il nostro.**

Gestione Casa deve limitarsi a generare/ripristinare il pacchetto cifrato, senza conoscere le credenziali del provider scelto dall'utente.

In una futura versione potrà esistere una funzione:

**Prepara/Ripristina Family Drive da backup**

che consenta di ricreare una nuova chiavetta a partire da un archivio cifrato conservato dall'utente.

---

## 16. Cifratura e chiavi

I dati condivisi e i backup dovranno essere cifrati.

La chiave di cifratura:

- deve nascere localmente;
- non deve essere il numero di licenza;
- non deve essere derivabile dal numero di licenza;
- non deve essere conservata nel License Manager;
- non deve essere recuperabile dai sistemi commerciali Gestione Casa.

La futura chiave Family dovrà essere separata dalla licenza commerciale.

L'eventuale recovery key dovrà restare sotto il controllo dell'utente.

Conseguenza consapevole: se l'utente perde tutti i dispositivi, il Family Drive e ogni backup/recovery key, Gestione Casa non può ricostruire magicamente i suoi dati.

---

## 17. Resilienza e ricostruzione

Il Family Drive non deve essere l'unica copia dei dati.

Ogni dispositivo mantiene il proprio database locale; il Family Drive mantiene lo stato condiviso/sincronizzato.

Scenari:

### Perdita di uno o più dispositivi

Il nuovo dispositivo può ricostruire lo spazio condiviso dal Family Drive.

### Guasto del router o del Family Drive

Se almeno un dispositivo conserva i dati, è possibile preparare un nuovo Family Drive e ricostruire l'archivio condiviso.

### Perdita totale domestica

Una soluzione esclusivamente locale non può proteggere da un evento che distrugga contemporaneamente dispositivi e supporti. L'utente può proteggersi scegliendo volontariamente un backup cifrato esterno.

---

## 18. Stato attuale del repository: fondamenta già presenti

L'audit del repository Gestione Casa OCR evidenzia diverse predisposizioni utili alla futura 2.0.

### Già presenti

- `UserMode = 'single' | 'family'` in `src/types/index.ts`.
- `RecordMetadata` con `version`, `deviceId` e `syncStatus`.
- `AppSettings.deviceId`.
- `getOrCreateDeviceId()` in `src/services/deviceService.ts`.
- primitive di sincronizzazione `pending/synced/conflict` usate per ContactRequest.
- `Product` e `ProductAlias`.
- `Product.categoryId` e `Product.subcategoryId`.
- catalogo/proposte di classificazione locale in `src/services/productClassification/`.
- Knowledge Base con livelli `BUILT-IN`, `LOCAL LEARNED` e predisposizione `SHARED DICTIONARY`.
- backup JSON completo in `src/services/backupService.ts`.
- database Dexie separato in tabelle, favorevole alla futura replica incrementale.
- architettura local-first documentata in `docs/architecture/local-first.md`.

### Non ancora presenti

- `familyId` o equivalente;
- `memberId`;
- `spaceId/vaultId`;
- scope personale/condiviso sui record;
- permessi di condivisione;
- transport LAN Family Drive;
- discovery del drive di rete;
- cifratura Family;
- motore generale di replica per tutte le entità;
- risoluzione completa dei conflitti multi-device;
- provisioning Family/Family Plus 2.0.

---

## 19. Cosa preservare già in Gestione Casa OCR

Senza implementare Family ora, Gestione Casa OCR deve evitare decisioni che rendano difficile la futura evoluzione.

In particolare:

- preservare `deviceId`, `version` e `syncStatus` nei modelli;
- mantenere entità normalizzate (`Product`, `ProductAlias`, `ExpenseItem`, `Supplier`, ecc.);
- non incorporare la logica della copia digitale solo nella UI;
- mantenere documenti e spese riapribili/collegabili;
- tenere OCR separato dalla logica contabile e dalla futura sincronizzazione;
- non usare la licenza come identità dei dati o chiave di cifratura;
- mantenere backup/import come funzioni indipendenti dal cloud.

---

## 20. Architettura futura proposta

Schema concettuale:

```text
              SISTEMA COMMERCIALE / LICENZE
             (separato dai dati dell'utente)
                        │
                        │ diritto d'uso
                        ▼
┌─────────────────────────────────────────────────────┐
│                  DEVICE LOCALE                      │
│                                                     │
│   Dexie / dati personali / OCR / catalogo          │
│           │                                         │
│           └──── Sync Engine locale ──────────┐      │
└──────────────────────────────────────────────┼──────┘
                                               │ LAN
                                               ▼
                                    ┌──────────────────┐
                                    │   FAMILY DRIVE   │
                                    │ USB/NAS/router   │
                                    │ cifrato          │
                                    └──────────────────┘
                                               │
                                               │ backup opzionale
                                               ▼
                                    destinazione scelta
                                       dall'utente
```

Il trasporto deve rimanere separato dal dominio applicativo:

`Dexie locale ⇄ Sync Engine ⇄ Family Drive LAN`

Il motore OCR non deve conoscere né il Family Drive né il cloud.

---

## 21. Roadmap futura indicativa

### Fase A — Preservazione Gestione Casa OCR

Stabilizzare OCR, copia digitale, catalogo prodotti, categorie per riga, riapertura documenti e backup, senza introdurre Family.

### Fase B — Modello Gestione Casa 2.0

Definire formalmente:

- member;
- device;
- personal/shared space;
- ownership;
- permessi;
- record scope.

### Fase C — Sync Engine indipendente dal trasporto

Implementare journal delle modifiche, revisioni, merge e conflitti.

### Fase D — Family Drive LAN

Aggiungere supporto al drive condiviso domestico tramite tecnologie compatibili con le piattaforme native previste.

### Fase E — Cifratura e disaster recovery

Family key, backup cifrato, ripristino Family Drive, recovery controllato dall'utente.

### Fase F — UX Family/Family Plus

Condivisione semplice e volontaria, invisibilità dei dati personali non condivisi, stato sincronizzazione chiaro e non tecnico.

---

## 22. Decisioni vincolanti emerse

1. Gestione Casa OCR resta la beta single-user.
2. Family/Family Plus appartiene a Gestione Casa 2.0.
3. Gestione Casa 2.0 non deve richiedere un dispositivo principale.
4. Il Family Drive può essere il punto neutrale di sincronizzazione e recupero.
5. La chiavetta è storage passivo; il software di sync gira nei device.
6. Ogni device mantiene un database locale autonomo.
7. Nessun database unico deve essere aperto contemporaneamente sulla chiavetta.
8. I dati sono privati per default.
9. La condivisione è sempre volontaria ed esplicita.
10. Appartenere allo stesso Family non significa vedere automaticamente tutto.
11. Licenza e dati dell'utente sono domini separati.
12. Numero licenza e chiave di cifratura non devono avere alcuna dipendenza.
13. Nessun cloud Gestione Casa è necessario per conservare i dati privati.
14. Il backup esterno è facoltativo e utilizza storage scelto dall'utente.
15. Gestione Casa non può e non deve recuperare dati privati conservati solo dall'utente.
16. Il sistema può recuperare/restituire la licenza secondo le regole commerciali, non la chiave dei dati.
17. La copia digitale dello scontrino deve essere l'interfaccia dell'utente normale; la diagnostica resta dietro le quinte.
18. Le correzioni confermate possono alimentare il catalogo locale.
19. Le categorie prodotto possono essere associate a livello di singola riga.
20. Tutte le future funzioni devono rispettare il principio: **Tutto è local, nulla è public.**

---

## 23. Questioni tecniche da decidere in fase 2.0

Restano volutamente aperti e NON devono essere decisi prematuramente durante la beta:

- protocollo LAN definitivo (SMB, WebDAV o adapter multipli);
- discovery automatico del Family Drive;
- formato esatto di journal/snapshot;
- algoritmo di merge e conflitto;
- gestione allegati grandi;
- strategia di cifratura e derivazione chiavi;
- recovery key e UX di recupero;
- pairing tra dispositivi;
- gestione della rimozione di un membro;
- migrazione dati da Gestione Casa OCR a Gestione Casa 2.0;
- comportamento iOS/Android/Windows/macOS nelle versioni native/Capacitor;
- compatibilità minima dei router.

---

## 24. Formula finale di prodotto

> **Gestione Casa custodisce la licenza. L'utente custodisce la propria vita privata.**
>
> **Tutto è local, nulla è public.**
>
> I dati appartengono all'utente, rimangono sui suoi dispositivi e vengono condivisi solo quando e con chi decide lui.

Questo documento deve essere utilizzato come fonte di riferimento quando verrà progettata Gestione Casa 2.0 e come vincolo per evitare che le scelte fatte durante lo sviluppo di Gestione Casa OCR rendano più difficile l'evoluzione futura.
