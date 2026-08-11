import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db } from '../database/db';
import { contactRequestRepository } from '../repositories';
import { backupService } from '../services/backupService';
import {
  type ContactRequestDocument,
} from '@gestione-casa/shared-sdk/contact-requests';

describe('Sottofase 2.3.B.2 - Persistenza Locale ContactRequest & Schema Dexie v8', () => {
  beforeEach(async () => {
    await contactRequestRepository.clear();
  });

  const sampleValidDoc: ContactRequestDocument = {
    id: 'req_20260807_001',
    requestType: 'support',
    status: 'new',
    source: 'gestione_casa_ocr',
    displayName: 'Mario Rossi',
    firstName: 'Mario',
    lastName: 'Rossi',
    companyName: null,
    email: 'gestionecasaocr@gmail.com',
    phone: null,
    preferredContactChannel: 'email',
    subject: 'Richiesta di supporto OCR',
    message: 'Problema con la scansione dello scontrino',
    privacyAcceptedAt: '2026-08-01T10:00:00.000Z',
    linkedCustomerId: null,
    linkedLicenseId: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    reviewedAt: null,
    closedAt: null,
    sourceDeviceId: 'device_test_01',
    sourceAppVersion: '1.0.0',
    syncStatus: 'pending',
    schemaVersion: 1,
    metadata: {},
  };

  it('TEST 1: Schema Dexie alla versione 8 e presenza tabella contactRequests', () => {
    expect(db.verno).toBeGreaterThanOrEqual(8);
    expect(db.contactRequests).toBeDefined();
    expect(typeof db.contactRequests.toArray).toBe('function');
  });

  it('TEST 2: CRUD completo tramite contactRequestRepository', async () => {
    // 1. Create
    const created = await contactRequestRepository.create(sampleValidDoc);
    expect(created.id).toBe('req_20260807_001');
    expect(created.syncStatus).toBe('pending');
    expect(created.schemaVersion).toBe(1);
    expect(created.linkedCustomerId).toBeNull();
    expect(created.linkedLicenseId).toBeNull();

    // 2. Count
    const count = await contactRequestRepository.count();
    expect(count).toBe(1);

    // 3. GetById
    const fetched = await contactRequestRepository.getById('req_20260807_001');
    expect(fetched).toBeDefined();
    expect(fetched?.email).toBe('gestionecasaocr@gmail.com');
    expect(fetched?.source).toBe('gestione_casa_ocr');

    // 4. GetAll
    const all = await contactRequestRepository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('req_20260807_001');

    // 5. Update
    const updated = await contactRequestRepository.update('req_20260807_001', {
      status: 'in_review',
      message: 'Messaggio aggiornato per revisione',
    });
    expect(updated.status).toBe('in_review');
    expect(updated.message).toBe('Messaggio aggiornato per revisione');
    expect(updated.syncStatus).toBe('pending'); // Must stay pending
    expect(updated.schemaVersion).toBe(1);
    expect(updated.linkedCustomerId).toBeNull();
    expect(updated.linkedLicenseId).toBeNull();

    // 6. Delete
    await contactRequestRepository.delete('req_20260807_001');
    const afterDelete = await contactRequestRepository.getById('req_20260807_001');
    expect(afterDelete).toBeUndefined();
    expect(await contactRequestRepository.count()).toBe(0);
  });

  it('TEST 3: Rifiuto di ID vuoti o duplicati in fase di inserimento', async () => {
    // ID vuoto
    const emptyIdDoc = { ...sampleValidDoc, id: '' };
    await expect(contactRequestRepository.create(emptyIdDoc)).rejects.toThrow();

    // ID con soli spazi
    const whitespaceIdDoc = { ...sampleValidDoc, id: '   ' };
    await expect(contactRequestRepository.create(whitespaceIdDoc)).rejects.toThrow();

    // Inserimento valido
    await contactRequestRepository.create(sampleValidDoc);

    // Duplicato ID
    await expect(contactRequestRepository.create(sampleValidDoc)).rejects.toThrow(
      'già esistente'
    );
  });

  it('TEST 4: Rifiuto di documenti non validi o con metadata non conformi', async () => {
    // Email non valida
    const invalidEmailDoc = { ...sampleValidDoc, id: 'req_002', email: 'email-non-valida' };
    await expect(contactRequestRepository.create(invalidEmailDoc)).rejects.toThrow();

    // Metadata non oggetto
    const invalidMetadataDoc = {
      ...sampleValidDoc,
      id: 'req_003',
      metadata: 'string-not-object' as unknown as Record<string, unknown>,
    };
    await expect(contactRequestRepository.create(invalidMetadataDoc)).rejects.toThrow();

    // Channel non valido
    const invalidChannelDoc = {
      ...sampleValidDoc,
      id: 'req_004',
      preferredContactChannel: 'whatsapp' as unknown as 'email',
    };
    await expect(contactRequestRepository.create(invalidChannelDoc)).rejects.toThrow();
  });

  it('TEST 5: Protezione delle semantiche di syncStatus e collegamenti cliente/licenza', async () => {
    await contactRequestRepository.create(sampleValidDoc);

    // L'aggiornamento non deve convertire pending in synced né creare collegamenti
    const updated = await contactRequestRepository.update('req_20260807_001', {
      status: 'in_review',
    });

    expect(updated.syncStatus).toBe('pending');
    expect(updated.linkedCustomerId).toBeNull();
    expect(updated.linkedLicenseId).toBeNull();
  });

  it('TEST 6: Integrazione Backup e Ripristino con la tabella contactRequests', async () => {
    // Inserisci una richiesta
    await contactRequestRepository.create(sampleValidDoc);

    // 1. Export backup
    const backupJson = await backupService.exportBackup();
    const backupData = JSON.parse(backupJson);

    expect(backupData.tables.contactRequests).toBeDefined();
    expect(backupData.tables.contactRequests).toHaveLength(1);
    expect(backupData.tables.contactRequests[0].id).toBe('req_20260807_001');

    // 2. Clear database
    await contactRequestRepository.clear();
    expect(await contactRequestRepository.count()).toBe(0);

    // 3. Import backup
    await backupService.importBackup(backupData);
    expect(await contactRequestRepository.count()).toBe(1);

    const restored = await contactRequestRepository.getById('req_20260807_001');
    expect(restored).toBeDefined();
    expect(restored?.email).toBe('gestionecasaocr@gmail.com');
    expect(restored?.syncStatus).toBe('pending');
  });

  it('TEST 7: Compatibilità retroattiva con file di backup precedenti alla versione 8', async () => {
    // Crea un payload di backup sprovvisto della sezione contactRequests
    const legacyBackup = {
      appName: 'Gestione Casa',
      version: '1.0.0',
      schemaVersion: '2.0.0',
      databaseName: 'gestioneCasa',
      exportedAt: new Date().toISOString(),
      checksum: 'fake_checksum',
      tables: {
        settings: [],
        contributors: [],
        incomeEntries: [],
        expenses: [],
        expenseItems: [],
        categories: [],
        suppliers: [],
        fixedExpenses: [],
        fixedExpenseOccurrences: [],
        savingPlans: [],
        savingMovements: [],
        projects: [],
        projectMovements: [],
        attachments: [],
        ocrProcesses: [],
        monthlyReports: [],
        extraBudgetMovements: [],
        auditLogs: [],
      },
    };

    // Ripristina il backup legacy
    await expect(backupService.importBackup(legacyBackup as any)).resolves.not.toThrow();

    // La tabella contactRequests deve rimanere vuota senza errori
    const count = await contactRequestRepository.count();
    expect(count).toBe(0);
  });

  it('TEST 8: Ripristino di un backup con ContactRequest non valida rifiutato con atomicità', async () => {
    const invalidBackup = {
      appName: 'Gestione Casa',
      version: '1.0.0',
      schemaVersion: '2.0.0',
      databaseName: 'gestioneCasa',
      exportedAt: new Date().toISOString(),
      checksum: 'fake_checksum',
      tables: {
        settings: [],
        contributors: [],
        incomeEntries: [],
        expenses: [],
        expenseItems: [],
        categories: [],
        suppliers: [],
        fixedExpenses: [],
        fixedExpenseOccurrences: [],
        savingPlans: [],
        savingMovements: [],
        projects: [],
        projectMovements: [],
        attachments: [],
        ocrProcesses: [],
        monthlyReports: [],
        extraBudgetMovements: [],
        auditLogs: [],
        contactRequests: [
          {
            ...sampleValidDoc,
            id: 'req_invalid_01',
            email: 'email-non-valida-senza-chiocciola',
          },
        ],
      },
    };

    // Il restore deve essere rifiutato
    await expect(backupService.importBackup(invalidBackup as any)).rejects.toThrow(
      'ContactRequest non valida'
    );

    // Verificare atomicità: nessuna richiesta deve essere presente
    const count = await contactRequestRepository.count();
    expect(count).toBe(0);
  });

  it('TEST 9: Migrazione reale IndexedDB / Dexie v7 -> v8 con conservazione dati preesistenti', async () => {
    const testDbName = 'test_v7_v8_migration_db';

    // 1. Apri un DB isolato in versione 7 (senza contactRequests)
    const dbV7 = new Dexie(testDbName);
    dbV7.version(7).stores({
      contributors: 'id, name, type',
      expenses: 'id, date, amount',
    });
    await dbV7.open();

    // 2. Inserisci un record reale v7
    await dbV7.table('contributors').add({
      id: 'contrib_v7_01',
      name: 'Mario Rossi V7',
      type: 'family',
      isSystem: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const preCount = await dbV7.table('contributors').count();
    expect(preCount).toBe(1);

    // 3. Chiudi il DB v7
    dbV7.close();

    // 4. Apri lo stesso DB con uno schema aggiornato alla versione 8
    const dbV8 = new Dexie(testDbName);
    dbV8.version(7).stores({
      contributors: 'id, name, type',
      expenses: 'id, date, amount',
    });
    dbV8.version(8).stores({
      contributors: 'id, name, type',
      expenses: 'id, date, amount',
      contactRequests: 'id, requestType, status, createdAt, syncStatus',
    });

    await dbV8.open();

    // 5. Verifiche migrazione v7 -> v8
    expect(dbV8.verno).toBe(8);
    expect(dbV8.table('contactRequests')).toBeDefined();
    expect(await dbV8.table('contactRequests').count()).toBe(0);

    const migratedContrib = await dbV8.table('contributors').get('contrib_v7_01');
    expect(migratedContrib).toBeDefined();
    expect(migratedContrib.name).toBe('Mario Rossi V7');

    // Pulizia finale
    dbV8.close();
    await Dexie.delete(testDbName);
  });

  it('TEST 10: Backup e Ripristino multiplo con conservazione integrale di linkedCustomerId, linkedLicenseId e syncStatus', async () => {
    const doc1 = sampleValidDoc;

    const doc2CanonicalConverted: ContactRequestDocument = {
      id: 'req_canonical_002',
      requestType: 'information',
      status: 'converted_to_customer',
      source: 'license_manager',
      displayName: 'Giuseppe Verdi',
      firstName: 'Giuseppe',
      lastName: 'Verdi',
      companyName: 'Verdi Srl',
      email: 'giuseppe@verdi.it',
      phone: '+3902123456',
      preferredContactChannel: 'phone',
      subject: 'Richiesta commerciale avanzata',
      message: 'Informazioni su licenza Enterprise',
      privacyAcceptedAt: '2026-07-01T10:00:00.000Z',
      linkedCustomerId: 'cust_abc_999',
      linkedLicenseId: 'lic_xyz_888',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-02T12:00:00.000Z',
      reviewedAt: '2026-07-01T11:00:00.000Z',
      closedAt: '2026-07-02T12:00:00.000Z',
      sourceDeviceId: 'dev_ext_02',
      sourceAppVersion: '2.0.0',
      syncStatus: 'synced',
      schemaVersion: 1,
      metadata: { tier: 'enterprise', notes: 'Cliente gia convertito' },
    };

    // Inserisci entrambi nel DB
    await db.contactRequests.bulkAdd([doc1, doc2CanonicalConverted]);
    expect(await contactRequestRepository.count()).toBe(2);

    // Export backup
    const backupJson = await backupService.exportBackup();
    const backupData = JSON.parse(backupJson);

    expect(backupData.tables.contactRequests).toHaveLength(2);

    // Clear DB
    await contactRequestRepository.clear();
    expect(await contactRequestRepository.count()).toBe(0);

    // Import backup
    await backupService.importBackup(backupData);
    expect(await contactRequestRepository.count()).toBe(2);

    // Verifica conservazione integrale di doc2CanonicalConverted
    const restoredDoc2 = await contactRequestRepository.getById('req_canonical_002');
    expect(restoredDoc2).toBeDefined();
    expect(restoredDoc2?.id).toBe('req_canonical_002');
    expect(restoredDoc2?.requestType).toBe('information');
    expect(restoredDoc2?.status).toBe('converted_to_customer');
    expect(restoredDoc2?.source).toBe('license_manager');
    expect(restoredDoc2?.preferredContactChannel).toBe('phone');
    expect(restoredDoc2?.syncStatus).toBe('synced'); // NON modificato in pending
    expect(restoredDoc2?.linkedCustomerId).toBe('cust_abc_999'); // Preservato
    expect(restoredDoc2?.linkedLicenseId).toBe('lic_xyz_888'); // Preservato
    expect(restoredDoc2?.metadata).toEqual({ tier: 'enterprise', notes: 'Cliente gia convertito' });
    expect(restoredDoc2?.createdAt).toBe('2026-07-01T10:00:00.000Z');
    expect(restoredDoc2?.updatedAt).toBe('2026-07-02T12:00:00.000Z');
    expect(restoredDoc2?.schemaVersion).toBe(1);
  });
});
