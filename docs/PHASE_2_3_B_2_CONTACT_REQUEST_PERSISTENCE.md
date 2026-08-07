# Fase 2.3 - Sottofase 2.3.B.2: Persistenza Locale ContactRequest in Gestione Casa OCR

## Oggetto della Sottofase

La Sottofase **2.3.B.2** ha implementato la persistenza locale delle richieste di contatto (`ContactRequest`) all'interno dell'applicazione **Gestione Casa OCR**, in conformità al modello canonico `ContactRequestDocument` ed al relativo validatore `ContactRequestValidator` forniti dallo **Shared SDK** versione `0.3.0` (`@gestione-casa/shared-sdk`).

---

## 1. Aggiornamento Schema Dexie (Versione 8)

Il database Dexie dell'applicazione (`GestioneCasaDatabase` in `src/database/db.ts`) è stato aggiornato alla **versione 8**:

```typescript
// src/database/db.ts
this.version(8).stores({
  contactRequests: 'id, requestType, status, createdAt, syncStatus',
});
```

### Indici Definiti per la Tabella `contactRequests`:
- `id` (Chiave Primaria)
- `requestType`
- `status`
- `createdAt`
- `syncStatus`

L'aggiornamento mantiene inalterate le versioni precedenti (2–7) e garantisce la migrazione trasparente dello schema senza impatto sui dati preesistenti.

---

## 2. Repository Locale (`contactRequestRepository`)

L'accesso applicativo alla tabella `contactRequests` è gestito in modo esclusivo e centralizzato tramite `contactRequestRepository` in `src/repositories/index.ts`.

### Metodi Implementati:
- `getAll()`: Restituisce l'elenco completo di tutte le richieste immagazzinate.
- `getById(id: string)`: Recupera una richiesta specifica per ID.
- `count()`: Restituisce il conteggio totale delle richieste.
- `clear()`: Svuota la tabella.
- `create(data: ContactRequestDocument)`:
  - Verifica che l'ID sia presente e non sia vuoto o composto da soli spazi.
  - Verifica che l'ID non sia già esistente nel database (previeni duplicati).
  - Controlla che il campo `metadata` sia un oggetto valido.
  - Valida il documento utilizzando `ContactRequestValidator.validate()` dallo Shared SDK.
  - Salva il record nel database preservando `syncStatus = 'pending'` e mantenendo `linkedCustomerId = null` e `linkedLicenseId = null`.
- `update(id: string, updates: Partial<ContactRequestDocument>)`:
  - Verifica che la richiesta esista prima dell'aggiornamento.
  - Garantisce che `schemaVersion` rimanga fisso al valore letterale `1`.
  - Calcola `updatedAt` assicurando che non sia mai antecedente a `createdAt`.
  - Mantiene `syncStatus` inalterato (senza convertire automaticamente `pending` in `synced`).
  - Rivalida l'intero documento derivato tramite `ContactRequestValidator.validate()`.
- `delete(id: string)`: Rimuove esclusivamente il record selezionato senza side-effect su altre tabelle.

---

## 3. Integrazione Backup e Ripristino (`backupService`)

Il servizio di backup (`src/services/backupService.ts`) e l'interfaccia `BackupData` (`src/types/index.ts`) sono stati aggiornati per includere la tabella `contactRequests`:

- **Esportazione**: `exportBackup()` include l'array `contactRequests` all'interno della struttura JSON esportata.
- **Importazione**: `importBackup()` ripristina la tabella `contactRequests` nell'ambito della transazione atomica di ripristino.
- **Validazione Canonica durante Restore (Sottofase 2.3.B.2a)**: Prima di effettuare la scrittura a database, ogni elemento dell'array `contactRequests` viene rigorosamente validato tramite `ContactRequestValidator.validate()` dello Shared SDK. Se anche un singolo documento risulta non valido, il ripristino viene bloccato sollevando un errore esplicito. Nessun dato viene alterato o riparato silenziosamente e l'atomicità garantisce che non vengano applicate modifiche parziali al database.
- **Conservazione Integrale Campi Canonici**: Durante il restore, i documenti canonici gia esistenti conservano inalterati tutti i valori originali, inclusi `syncStatus` (`synced`, `conflict`), `linkedCustomerId` e `linkedLicenseId`.
- **Compatibilità Retroattiva**: Se viene importato un backup generato con una versione dello schema precedente (pre-v8, privo della chiave `contactRequests`), l'operazione viene completata con successo lasciando la tabella `contactRequests` vuota (array vuoto), senza sollevare errori.

---

## 4. Garanzie di Isolamento e Regole di Dominio

- **syncStatus**: Tutte le richieste create o modificate localmente in questa fase nell'app OCR nascono con lo stato di sincronizzazione `pending`. Il restore di backup di documenti canonici ricevuti o precedentemente sincronizzati preserva invece lo stato originario (`synced`, `conflict`, ecc.) senza forzarlo a `pending`.
- **Nessuna interfaccia utente (UI)**: Non sono state modificate né aggiunte rotte, viste o form di contatto in questa sottofase.
- **Nessuna integrazione automatica**: Non sono stati creati collegamenti automatici a clienti o licenze per le nuove richieste create localmente dall'app OCR (`linkedCustomerId` e `linkedLicenseId` rimangono `null`).

---

## 5. Test di Validazione e Quality Gate (Sottofase 2.3.B.2a)

La suite di test `src/tests/contactRequestPersistence.test.ts` (10 test totali) verifica:

1. **Schema Dexie v8**: Corretta registrazione della versione 8 e presenza della tabella `contactRequests`.
2. **CRUD Repository**: Inserimento, lettura per ID, conteggio, elenco, aggiornamento e cancellazione.
3. **Validazione Rigorosa**: Rifiuto di ID vuoti o duplicati, validazione formati e tipi di contatto tramite lo Shared SDK.
4. **Protezione Semantica**: Conservazione di `syncStatus = 'pending'` e dei campi `linkedCustomerId` / `linkedLicenseId` per le nuove richieste OCR.
5. **Backup/Restore Base**: Integrazione completa nell'export/import JSON e verifica di compatibilità con backup legacy pre-v8.
6. **Validazione e Atomicità Restore**: Rifiuto immediato di file di backup contenenti `ContactRequest` non valide, senza ripristini parziali.
7. **Migrazione Reale Dexie v7 -> v8**: Apertura effettiva di un database IndexedDB/Dexie v7 con dati reali (es. `contributors`), chiusura e riapertura in v8, verificando la presenza della tabella `contactRequests` vuota ed il mantenimento inalterato dei dati preesistenti v7.
8. **Backup/Restore Multiplo e Relazioni**: Export e restore di più documenti canonici con valori distinti, dimostrando la preservazione integrale di `linkedCustomerId`, `linkedLicenseId`, `syncStatus` (`synced`), `metadata` e timestamp.

---

## 6. Stato dei Quality Gate

Tutti i Quality Gate applicativi risultano VERDI:

- **Typecheck**: `npm run typecheck` PASS
- **Linter**: `npm run lint` PASS
- **Test Suite**: `npx vitest run` PASS (36 file di test, 261 test superati)
- **Build Production**: `npm run build` PASS
