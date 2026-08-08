# FASE 2.5.C – IMPORT RISPOSTA LICENSE MANAGER E RICONCILIAZIONE CONTACT REQUEST

## Overview

La Sottofase **2.5.C** di **Gestione Casa OCR** implementa l'importazione della risposta JSON prodotta dal License Manager e la riconciliazione atomica dei dati con le richieste di contatto memorizzate nel database locale Dexie (`contactRequests`).

---

## Principi Guida e Vincoli Architetturali

1. **Protocollo 2.5 OCR ↔ License Manager**:
   - Utilizza lo SDK condiviso (`@gestione-casa/shared-sdk v0.3.0`).
   - Formato inviluppo: `gestione-casa-contact-request` version 1.
   - Idempotente e privo di effetti collaterali di rete.

2. **Autorità del License Manager**:
   - License Manager è la fonte primaria di verità per gli stati di gestione della richiesta:
     - `status` (`converted_to_customer`, `rejected`, `closed`, `in_review`, `new`)
     - `linkedCustomerId`
     - `linkedLicenseId`
     - `reviewedAt`
     - `closedAt`
     - `updatedAt`

3. **Invarianza Schema Dexie**:
   - La versione del database Dexie rimane **`version(8)`**. Nessun bump a `version(9)`.
   - La tabella `contactRequests` non ha subito modifiche di indici o colonne.

4. **Regole di Riconciliazione**:
   - **Stati Terminali LM** (`converted_to_customer`, `rejected`, `closed`):
     - Prevalgono sempre sullo stato locale.
     - Impostano `syncStatus = 'synced'`.
   - **Contenuto Equivalente**:
     - Se il record remoto ha campi di business identici a quello locale, imposta `syncStatus = 'synced'` con stato `equivalent`.
   - **Stati Non Terminali e Conflitti**:
     - Se la risposta LM è non terminale (es. `in_review`) ma le modifiche locali `pending` hanno un `updatedAt` più recente rispetto alla risposta remota, viene segnalato un **conflitto di sincronizzazione** (`syncStatus = 'conflict'`).
   - **Record Locale Mancante**:
     - Se il file JSON fa riferimento a una richiesta di contatto non presente nel database locale, non viene creato alcun record e viene restituito `missing_local_record`.

---

## Componenti e Moduli Modificati

### 1. `src/repositories/index.ts`
- Aggiunto il metodo `applyRemoteRecord(remoteDoc: ContactRequestDocument): Promise<ApplyRemoteRecordResult>` in `contactRequestRepository`.
- Gestisce il recupero atomico del record locale, la verifica delle equivalenze di business, l'applicazione degli stati terminali LM, la rileva dei conflitti e la persistenza validata via `ContactRequestValidator`.

### 2. `src/services/contactRequestSyncService.ts`
- Funzione `importContactRequestSyncResponse(jsonContent: string): Promise<ImportSyncResponseResult>`.
- Deserializza e valida l'inviluppo tramite lo Shared SDK (`deserializeContactRequestExchangeEnvelope`).
- Invoca `contactRequestRepository.applyRemoteRecord` per la riconciliazione.

### 3. `src/features/settings/ContactPage.tsx`
- Interfaccia utente aggiornata per permettere la selezione e l'importazione manuale del file JSON di risposta.
- Visualizzazione immediata dello stato dell'operazione (`applied`, `equivalent`, `conflict`, `missing_local_record`, `invalid_format`).
- Badge e dettagli visivi sui dati collegati (`linkedCustomerId`, `linkedLicenseId`, `syncStatus`).

---

## Test e Copertura

Tutti i comportamenti e gli scenari di riconciliazione sono coperti dalla suite di test in `src/tests/phase-2-5-c-reconciliation.test.ts`:
1. `converted_to_customer` (Stato terminale + link cliente e licenza)
2. `rejected` (Stato terminale)
3. `closed` (Stato terminale)
4. `in_review` (Stato non terminale)
5. `equivalent` (Record remoti identici)
6. `conflict` (Modifiche locali pending più recenti di risposta non terminale)
7. `missing_local_record` (ID non presente)
8. `invalid_format` (JSON o inviluppo non valido)
