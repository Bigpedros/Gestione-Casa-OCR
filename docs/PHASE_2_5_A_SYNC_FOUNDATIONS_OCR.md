# Fase 2.5.A – Fondamenta di Sincronizzazione: Device ID + Repository Contact Request

## Panoramica

La **Sottofase 2.5.A** implementa l'infrastruttura di base e le primitive di persistenza necessarie per la futura sincronizzazione tra **Gestione Casa OCR** e **Gestione Casa License Manager**.

In questa sottofase **non** è ancora eseguita alcuna sincronizzazione reale (nessun trasferimento file automatico, nessun backend, nessuna chiamata di rete).

---

## Componenti e Modifiche Implementate

### 1. Device ID Persistente (`src/services/deviceService.ts`)
- Implementata la funzione `getOrCreateDeviceId()`:
  - Legge `deviceId` dalle `AppSettings` locali (`db.settings`).
  - Se già presente, lo restituisce invariato garantendo la stabilità tra riavvii.
  - Se assente, genera un UUID unico con prefisso `DEV-` (es. `DEV-12345678-1234-4234-8234-123456789abc`) e lo salva nelle impostazioni.
- `AppSettings` interface aggiornata in `src/types/index.ts` con la proprietà opzionale `deviceId?: string | null`.

### 2. Generazione ContactRequest (`src/features/settings/ContactPage.tsx`)
- Ogni nuova `ContactRequestDocument` creata dall'interfaccia utente imposta:
  - `sourceDeviceId`: valore restituito da `getOrCreateDeviceId()`.
  - `sourceAppVersion`: versione canonica dell'applicazione `APP_CONFIG.version` (`1.0.0`).
  - `syncStatus`: `'pending'`.

### 3. Primitive di Sincronizzazione nel Repository (`src/repositories/index.ts`)
Aggiunti e potenziati i metodi su `contactRequestRepository`:

1. `getBySyncStatus(status)`:
   - Filtra i documenti tramite l'indice Dexie `syncStatus`.
   - Supporta i valori `'pending' | 'synced' | 'conflict'`.
2. `getPending()`:
   - Restituisce esclusivamente i record con `syncStatus = 'pending'`.
3. `getConflicts()`:
   - Restituisce esclusivamente i record con `syncStatus = 'conflict'`.
4. `markSynced(id)`:
   - Imposta esclusivamente `syncStatus = 'synced'` via update mirato Dexie.
   - Preserva intatti tutti i dati di business e i metadati, incluso `updatedAt` (prevenendo falsi conflitti di sincronizzazione).
5. `markConflict(id)`:
   - Imposta esclusivamente `syncStatus = 'conflict'`.
   - Preserva intatti i dati di business e `updatedAt`.
6. `update(id, updates)`:
   - Le modifiche business locali impostano automaticamente `syncStatus = 'pending'`, a meno che un valore esplicito di `syncStatus` non venga fornito.

---

## Schema Database e Persistenza

- **Versione Dexie**: Conservata a `version(8)`.
- **Indice Dexie**: `syncStatus` già presente nell'indice della tabella `contactRequests` (`'id, requestType, status, createdAt, syncStatus'`).
- **Nessuna modifica allo schema** o alle tabelle esistenti.

---

## Test e Validazione

I test della Sottofase 2.5.A sono stati inseriti in `src/tests/phase-2-5-a-sync-foundations.test.ts` e verificano:
1. Generazione del Device ID, prefisso `DEV-` e stabilità nelle chiamate successive.
2. Filtraggio tramite `getBySyncStatus`, `getPending` e `getConflicts`.
3. `markSynced` e `markConflict` aggiornano solo `syncStatus` senza alterare `updatedAt` né i dati di business (`status`, `linkedCustomerId`, `linkedLicenseId`, ecc.).
4. Le modifiche di business locali riportano `syncStatus` a `'pending'`.
