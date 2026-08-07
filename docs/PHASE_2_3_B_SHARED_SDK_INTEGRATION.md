# Integrazione Shared SDK - Sottofase 2.3.B.1

## Panoramica dell'Integrazione

La Sottofase 2.3.B.1 implementa l'integrazione tecnica del pacchetto condiviso `@gestione-casa/shared-sdk` versione `0.3.0` nell'applicazione **Gestione Casa OCR**.

Conformemente alle direttive operative:
- Il pacchetto è stato scaricato una sola volta dall'asset di release ufficiale su GitHub.
- L'archivio TGZ è stato archiviato localmente nella cartella `vendor/` e tracciato nel repository.
- Tutte le build e installazioni successive utilizzano la dipendenza file locale senza richiedere connessioni a GitHub.

---

## Dettagli dell'Artefatto e dell'Ambiente

- **Origine dell'Artefatto**: GitHub Release v0.3.0 (`Bigpedros/Gestione-Casa-Shared-SDK`)
- **URL Asset scaricato**: `https://github.com/Bigpedros/Gestione-Casa-Shared-SDK/releases/download/v0.3.0/gestione-casa-shared-sdk-0.3.0.tgz`
- **Percorso locale**: `vendor/gestione-casa-shared-sdk-0.3.0.tgz`
- **Dimensione file**: `25.426 byte`
- **Checksum SHA-256**: `12e535719ab784748250f4933c0cb84ae067f8cd1a978b1d78c8d71fce8f6233`
- **Package Metadata (interno)**:
  - `name`: `@gestione-casa/shared-sdk`
  - `version`: `0.3.0`
- **Package Manager Rilevato**: `npm` (con tracciamento in `package-lock.json`)

---

## Configurazione della Dipendenza Locale

Nel file `package.json` è stata aggiunta la dipendenza locale diretta:

```json
{
  "dependencies": {
    "@gestione-casa/shared-sdk": "file:vendor/gestione-casa-shared-sdk-0.3.0.tgz"
  }
}
```

L'installazione tramite `npm install` ha aggiornato `package-lock.json` risolvendo il pacchetto dal file locale `vendor/gestione-casa-shared-sdk-0.3.0.tgz`.

---

## Verifica degli Import e Test End-to-End

È stata creata la suite di test tecnica `src/tests/shared-sdk-integration.test.ts` per convalidare:

1. **Importazione dai sottopercorsi espressi**:
   - `@gestione-casa/shared-sdk`
   - `@gestione-casa/shared-sdk/common`
   - `@gestione-casa/shared-sdk/licensing`
   - `@gestione-casa/shared-sdk/customers`
   - `@gestione-casa/shared-sdk/contact-requests`

2. **Costanti di scambio e schema**:
   - `CONTACT_REQUEST_EXCHANGE_FORMAT` = `'gestione-casa-contact-request'`
   - `CONTACT_REQUEST_EXCHANGE_FORMAT_VERSION` = `1`

3. **Ciclo di scambio End-to-End**:
   - Costruzione di un documento canonico `ContactRequestDocument` (`syncStatus = 'pending'`, `source = 'gestione_casa_ocr'`).
   - Validazione con `ContactRequestValidator.validate()`.
   - Generazione dell'envelope di scambio mediante `createContactRequestExchangeEnvelope()`.
   - Serializzazione JSON tramite `serializeContactRequestExchangeEnvelope()`.
   - Deserializzazione JSON via `deserializeContactRequestExchangeEnvelope()`.
   - Validazione dell'envelope deserializzato mediante `validateContactRequestExchangeEnvelope()`.
   - Generazione del nome file per l'esportazione tramite `buildContactRequestExchangeFileName()`.

---

## Garanzie di Isolamento e Non-Regressione

- **Dexie DB**: Invariato (nessuna modifica a tabelle, schemi o migrazioni in `src/database/db.ts`).
- **Interfaccia Utente (UI)**: Invariata (nessuna nuova schermata, form o rotta creata in questa sottofase).
- **Logica di Dominio Esistente**: OCR, bilancio, notifiche, licenze e report rimangono inalterati.
- **Distribuzione**: Nessuna pubblicazione o push su GitHub eseguito.
