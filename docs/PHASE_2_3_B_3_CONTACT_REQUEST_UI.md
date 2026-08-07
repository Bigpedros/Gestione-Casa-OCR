# Sottofase 2.3.B.3 - Modulo UI "Supporto e Contatti"

## Panoramica

La sottofase **2.3.B.3** della Master Roadmap di Gestione Casa OCR implementa l'interfaccia utente (UI) per la gestione delle richieste di supporto, contatto, attivazione e rinnovo licenze all'interno dell'applicazione.

Il modulo consente di raccogliere e validare i dati forniti dall'utente, salvando la richiesta esclusivamente nel database locale IndexedDB (Dexie) tramite l'architettura canonica completata nelle sottofasi precedenti (2.3.B.1 e 2.3.B.2).

---

## 1. Nuova Route e Navigazione

- **Route aggiunta**: `/settings/contact` (`ROUTES.CONTACT`)
- **Accessibilità**: Raggiungibile direttamente dalla sezione **Impostazioni** (`/settings`) tramite una card dedicata con etichetta **Supporto e Contatti**.
- **Invarianza**: Nessuna altra route esistente dell'applicazione è stata modificata o alterata.

---

## 2. Struttura Pagina e Form "Supporto e Contatti"

La pagina `ContactPage.tsx` (`src/features/settings/ContactPage.tsx`) include:

- Titolo principale: **Supporto e Contatti**
- Testo informativo sintetico e rassicurante riguardante il salvataggio locale e riservato dei dati.
- Form interattivo con validazione locale prima del salvataggio.
- Area di conferma post-salvataggio con riepilogo dettagliato della richiesta creata.
- Azioni post-salvataggio:
  - **Esporta JSON richiesta**: Genera e scarica il file JSON conforme all'inviluppo canonico.
  - **Apri email**: Apre il client di posta predefinito verso `gestionecasaocr@gmail.com` via `mailto:`.
  - **Nuova richiesta**: Ripristina il form per una nuova compilazione.

---

## 3. Campi del Form e Mapping Canoniche

Tutti i campi gestiti dal form mappano direttamente sul modello canonico `ContactRequestDocument` fornito dallo Shared SDK `@gestione-casa/shared-sdk`:

1. **Nome** (`firstName`): Stringa obbligatoria.
2. **Cognome** (`lastName`): Stringa opzionale.
3. **Email** (`email`): Stringa obbligatoria, validata mediante pattern e regole SDK.
4. **Telefono** (`phone`): Stringa opzionale (obbligatoria se il canale preferito è `phone`).
5. **Tipo di richiesta** (`requestType`): Valore canonico in inglese salvato nel DB:
   - `information` → UI: **Informazioni**
   - `support` → UI: **Supporto**
   - `license_request` → UI: **Richiesta licenza**
   - `activation_request` → UI: **Richiesta attivazione**
   - `renewal_request` → UI: **Richiesta rinnovo**
   - `other` → UI: **Altro**
6. **Canale preferito** (`preferredContactChannel`):
   - `email` → UI: **Email**
   - `phone` → UI: **Telefono**
7. **Oggetto / Titolo** (`subject`): Stringa obbligatoria.
8. **Messaggio** (`message`): Stringa obbligatoria.
9. **Consenso Privacy** (`privacyAcceptedAt`): Checkbox obbligatorio. Imposta la data ISO di accettazione al momento della conferma.

---

## 4. Generazione Dati e Regole Canoniche di Default

Alla creazione di una nuova richiesta originata dall'applicazione OCR, vengono impostati automaticamente i seguenti valori di default:

- `source`: `"gestione_casa_ocr"`
- `status`: `"new"`
- `syncStatus`: `"pending"`
- `schemaVersion`: `1`
- `metadata`: `{}`
- `linkedCustomerId`: `null`
- `linkedLicenseId`: `null`
- `createdAt` / `updatedAt` / `privacyAcceptedAt`: Timestamp ISO correnti.
- `id`: Pattern generato localmente `req_<timestamp>_<random>`.

---

## 5. Validazione e Persistenza Locale

1. **Validazione UI**: I campi form vengono controllati in tempo reale (privacy accettata, campi obbligatori, formato email).
2. **Validazione SDK**: Il documento candidato `ContactRequestDocument` viene validato con `ContactRequestValidator.validate()` fornito dallo Shared SDK.
3. **Salvataggio Repository**: Il salvataggio avviene esclusivamente tramite `contactRequestRepository.create(candidateDoc)`. **Nessuna scrittura diretta in Dexie dalla UI.**

---

## 6. Esportazione JSON e Funzionalità Mailto

- **Esportazione JSON**:
  - Utilizza le funzioni canoniche dello Shared SDK:
    - `createContactRequestExchangeEnvelope()`
    - `serializeContactRequestExchangeEnvelope()`
    - `buildContactRequestExchangeFileName()`
  - Il formato dell'inviluppo è `gestione-casa-contact-request` con `formatVersion = 1`.
  - Il nome file è autogenerato dallo SDK (es. `gestione-casa-contact-request_req_1723050000000_abc12_20260807-120000.json`).
  - L'operazione di esportazione **non altera** lo stato `syncStatus`, che rimane `"pending"`.
- **Apertura Mailto**:
  - Pulsante opzionale "Apri email" diretto a `gestionecasaocr@gmail.com`.
  - Inserisce l'ID e il tipo di richiesta nell'oggetto/corpo e un promemoria per l'utente per allegare il file JSON esportato.
  - Non modifica lo stato `syncStatus` (rimane `"pending"`).

---

## 7. Regola Riservata syncStatus

In questa fase:
- `syncStatus` rimane sempre ed esclusivamente `"pending"`.
- Salvare la richiesta, esportarla in JSON, scaricare il file o aprire l'email mailto **non imposta mai** lo stato `synced`.
- Il passaggio a `synced` sarà gestito esclusivamente nella futura fase di sincronizzazione automatica / backend.

---

## 8. Limitazioni della Sottofase 2.3.B.3

Come definito dai requisiti della Roadmap Master:
1. **Assenza di Backend**: Nessun invio automatico o server remoto di ricezione email è attivo o configurato.
2. **Assenza di Sync Automatica**: Non è attiva alcuna sincronizzazione automatica via rete.
3. **Assenza di Conversione Cliente / Licenza**: Non vengono creati record `Customer` o `LicenseDocument` e non vengono valorizzati `linkedCustomerId` o `linkedLicenseId` (che rimangono rigorosamente `null`).

---

## 9. Quality Gate e Copertura Test

- **0 errori TypeScript**: verificato via `npm run typecheck`.
- **0 warning/errori Lint**: verificato via `npm run lint`.
- **Tutti i test superati**: inclusi i test preesistenti (261) e i nuovi test per il modulo UI `ContactPage` (`src/tests/contactRequestUI.test.tsx`).
- **Build di produzione completata con successo**: verificato via `npm run build`.
