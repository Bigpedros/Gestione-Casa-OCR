import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { db } from '../database/db';
import { LicenseProvider } from '../context/LicenseContext';
import { SettingsPage } from '../features/settings/SettingsPage';
import { LicensePage } from '../features/settings/LicensePage';
import { ContactPage } from '../features/settings/ContactPage';
import { ContributorsSettingsPage } from '../features/settings/ContributorsSettingsPage';
import { localLicenseRepository } from '../services/licensing';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { ACTIVATION_CONFIG } from '../config/activation.config';
import { getOrCreateDeviceId } from '../services/deviceService';
import {
  buildCanonicalLicensePayloadV2,
  buildCanonicalValidationReceiptV1,
  computeLicensePayloadHashV2,
  type SignedLicenseDocumentV2,
  type SignedValidationReceiptV1,
  type ValidationReceiptV1,
} from '@gestione-casa/shared-sdk/activation';
import type { LicenseDocumentV2 } from '@gestione-casa/shared-sdk/licensing';

function generateEd25519TestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKey: spkiBase64, privateKey };
}

function createSignedTestDoc(
  licenseDoc: Partial<LicenseDocumentV2>,
  privateKey: crypto.KeyObject,
): SignedLicenseDocumentV2 {
  const fullDoc: LicenseDocumentV2 = {
    id: licenseDoc.id || 'LIC-V2-TEST',
    licenseCode: licenseDoc.licenseCode || 'ABCD-EFGH-JKMN-PQRQ',
    checksum: licenseDoc.checksum || 'Q',
    edition: licenseDoc.edition || 'professional',
    term: licenseDoc.term || 'annual',
    status: licenseDoc.status || 'activated',
    owner: licenseDoc.owner || 'Mario Rossi',
    customerId: licenseDoc.customerId ?? 'CUST-200',
    deviceId: licenseDoc.deviceId ?? 'DEV-12345678-1234-1234-1234-123456789012',
    generatedAt: licenseDoc.generatedAt || '2026-08-01T00:00:00.000Z',
    assignedAt: null,
    sentAt: null,
    activatedAt: '2026-08-01T00:00:00.000Z',
    suspendedAt: null,
    revokedAt: null,
    expiresAt: '2027-08-01T00:00:00.000Z',
    engineVersion: '2.1',
    schemaVersion: 2,
    offlinePolicy: { allowed: true, maxDays: 30 },
    metadata: {},
  };

  const canonicalPayload = buildCanonicalLicensePayloadV2(fullDoc);
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey);

  return {
    license: fullDoc,
    signature: signatureBuffer.toString('base64'),
    signatureAlgorithm: 'Ed25519',
    keyId: 'test-key-1',
    signatureVersion: 2,
    canonicalPayload,
  };
}

function createSignedTestReceipt(
  receipt: Partial<ValidationReceiptV1>,
  signedDoc: SignedLicenseDocumentV2,
  privateKey: crypto.KeyObject,
): SignedValidationReceiptV1 {
  const licensePayloadHash = computeLicensePayloadHashV2(signedDoc.license);
  const fullReceipt: ValidationReceiptV1 = {
    receiptVersion: 1,
    receiptId: receipt.receiptId || 'REC-V1-TEST',
    licenseId: signedDoc.license.id,
    deviceId: signedDoc.license.deviceId || 'DEV-12345678-1234-1234-1234-123456789012',
    licenseSchemaVersion: 2,
    validatedAt: '2026-08-15T00:00:00.000Z',
    offlineValidUntil: '2026-09-15T00:00:00.000Z',
    licenseExpiresAt: signedDoc.license.expiresAt,
    licensePayloadHash,
  };

  const canonicalPayload = buildCanonicalValidationReceiptV1(fullReceipt);
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey);

  return {
    receipt: fullReceipt,
    signature: signatureBuffer.toString('base64'),
    signatureAlgorithm: 'Ed25519',
    keyId: 'test-key-1',
    signatureVersion: 1,
    canonicalPayload,
  };
}

describe('Riorganizzazione Grafica Impostazioni / Licenza Software & Contributori', () => {
  beforeEach(async () => {
    await db.localLicenses.clear();
    await db.contributors.clear();
    await db.settings.clear();
    await seedInitialCategoriesAndSettings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Hub Impostazioni: struttura a 3 macro-aree e 12 card di navigazione', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Impostazioni' })).toBeInTheDocument();
    });

    // 3 macro-aree
    expect(screen.getByText('1. Gestione della Casa')).toBeInTheDocument();
    expect(screen.getByText('2. Esperienza e Funzionalità')).toBeInTheDocument();
    expect(screen.getByText('3. Dati e Assistenza')).toBeInTheDocument();

    // 12 card
    expect(screen.getByText('Generali')).toBeInTheDocument();
    expect(screen.getByText('Contributori')).toBeInTheDocument();
    expect(screen.getByText('Categorie')).toBeInTheDocument();
    expect(screen.getByText('Fornitori')).toBeInTheDocument();
    expect(screen.getByText('OCR')).toBeInTheDocument();
    expect(screen.getByText('Notifiche')).toBeInTheDocument();
    expect(screen.getByText('Aspetto')).toBeInTheDocument();
    expect(screen.getByText('Moduli')).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByText('Allegati')).toBeInTheDocument();
    expect(screen.getByText('Licenza')).toBeInTheDocument();
    expect(screen.getByText('Supporto')).toBeInTheDocument();
  });

  it('2. Card Licenza mostra link alla pagina Licenza software', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Licenza/i })).toBeInTheDocument();
    });
  });

  it('3. Pagina Licenza software mostra badge e dettagli licenza attiva', async () => {
    const keyPair = generateEd25519TestKeyPair();
    vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(keyPair.publicKey);

    const deviceId = await getOrCreateDeviceId();
    const signedDoc = createSignedTestDoc(
      { licenseCode: 'ABCD-EFGH-JKMN-PQRQ', deviceId, edition: 'professional', owner: 'Famiglia Bellotti' },
      keyPair.privateKey
    );
    const signedReceipt = createSignedTestReceipt(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 1000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
      deviceId,
      status: 'VALID',
      licenseType: 'professional',
      activatedAt: new Date().toISOString(),
      lastSuccessfulOnlineValidation: new Date().toISOString(),
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
    });

    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/license']}>
          <Routes>
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Attiva e Valida')).toBeInTheDocument();
      expect(screen.getByText('ABCD-****-****-PQRQ')).toBeInTheDocument();
      expect(screen.getByText(/Famiglia Bellotti/i)).toBeInTheDocument();
    });
  });

  it('4. Navigazione /settings -> /settings/license e ritorno a /settings', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Licenza/i })).toBeInTheDocument();
    });

    // Clicca sulla card Licenza
    const licenseLink = screen.getByRole('link', { name: /Licenza/i });
    await act(async () => {
      fireEvent.click(licenseLink);
    });

    // Ora si trova sulla pagina Licenza software
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Licenza software' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Torna a Impostazioni/i })).toBeInTheDocument();
      expect(screen.getByText('Licenza Software')).toBeInTheDocument();
    });

    // Clicca su Torna a Impostazioni
    const backBtn = screen.getByRole('link', { name: /Torna a Impostazioni/i });
    await act(async () => {
      fireEvent.click(backBtn);
    });

    // Torna su Impostazioni
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Impostazioni' })).toBeInTheDocument();
    });
  });

  it('5. Contributori: nuova configurazione mostra inizialmente 1 solo contributore', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/contributors']}>
          <Routes>
            <Route path="/settings/contributors" element={<ContributorsSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Contributore 1')).toBeInTheDocument();
    });

    expect(screen.queryByText('Contributore 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Contributore 3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Aggiungi contributore/i })).toBeInTheDocument();
  });

  it('6. Contributori: aggiunta progressiva del secondo e terzo contributore fino al blocco a 3', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/contributors']}>
          <Routes>
            <Route path="/settings/contributors" element={<ContributorsSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Contributore 1')).toBeInTheDocument();
    });

    // Aggiunge 2° contributore
    const addBtn = screen.getByRole('button', { name: /\+ Aggiungi contributore/i });
    await act(async () => {
      fireEvent.click(addBtn);
    });

    expect(screen.getByText('Contributore 2')).toBeInTheDocument();
    expect(screen.queryByText('Contributore 3')).not.toBeInTheDocument();

    // Aggiunge 3° contributore
    await act(async () => {
      fireEvent.click(addBtn);
    });

    expect(screen.getByText('Contributore 3')).toBeInTheDocument();

    // Limite raggiunto (3): il pulsante scompare e compare l'avviso
    expect(screen.queryByRole('button', { name: /\+ Aggiungi contributore/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Limite massimo raggiunto \(3 contributori\)/i)).toBeInTheDocument();
  });

  it('7. Contributori: configurazioni esistenti con 2 o 3 contributori salvati continuano ad essere mostrate', async () => {
    const now = new Date().toISOString();
    await db.contributors.clear();
    await db.contributors.bulkPut([
      {
        id: 'contrib-1',
        order: 1,
        name: 'Pietro Bellotti',
        label: 'Stipendio',
        active: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
      {
        id: 'contrib-2',
        order: 2,
        name: 'Maria Rossi',
        label: 'Stipendio',
        active: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
      {
        id: 'contrib-3',
        order: 3,
        name: 'Giuseppe Verde',
        label: 'Pensione',
        active: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
    ]);

    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/contributors']}>
          <Routes>
            <Route path="/settings/contributors" element={<ContributorsSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Pietro Bellotti')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Maria Rossi')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Giuseppe Verde')).toBeInTheDocument();
    });

    expect(screen.getByText(/Limite massimo raggiunto \(3 contributori\)/i)).toBeInTheDocument();
  });

  it('7b. Contributori: placeholder inattivi non utilizzati non vengono mostrati, mentre record con dati reali anche se inattivi vengono preservati', async () => {
    const now = new Date().toISOString();
    await db.incomeEntries.clear();
    await db.contributors.clear();
    await db.contributors.bulkPut([
      {
        id: 'contrib-1',
        order: 1,
        name: 'Pietro Bellotti',
        label: 'Stipendio',
        active: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
      {
        id: 'contrib-2',
        order: 2,
        name: 'Contributore 2',
        email: 'nome@esempio.com',
        label: 'Stipendio',
        active: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
    ]);

    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/contributors']}>
          <Routes>
            <Route path="/settings/contributors" element={<ContributorsSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Pietro Bellotti')).toBeInTheDocument();
    });

    // Il placeholder inattivo predefinito non viene mostrato come secondo box
    expect(screen.queryByDisplayValue('Contributore 2')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('nome@esempio.com')).not.toBeInTheDocument();
    const addBtn = screen.getByRole('button', { name: /\+ Aggiungi contributore/i });
    expect(addBtn).toBeInTheDocument();

    // Cliccando "+ Aggiungi contributore" viene attivata la 2a card riutilizzando il placeholder
    await act(async () => {
      fireEvent.click(addBtn);
    });

    expect(screen.getByText('Contributore 2')).toBeInTheDocument();
  });

  it('7c. Contributori: secondo contributore inattivo ma personalizzato dall utente resta visibile', async () => {
    const now = new Date().toISOString();
    await db.incomeEntries.clear();
    await db.contributors.clear();
    await db.contributors.bulkPut([
      {
        id: 'contrib-1',
        order: 1,
        name: 'Pietro Bellotti',
        label: 'Stipendio',
        active: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
      {
        id: 'contrib-2',
        order: 2,
        name: 'Maria Rossi',
        label: 'Stipendio',
        active: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
    ]);

    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/contributors']}>
          <Routes>
            <Route path="/settings/contributors" element={<ContributorsSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Pietro Bellotti')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Maria Rossi')).toBeInTheDocument();
    });
  });

  it('7d. Contributori: secondo contributore inattivo con nome standard ma referenziato da entrate resta visibile', async () => {
    const now = new Date().toISOString();
    await db.contributors.clear();
    await db.incomeEntries.clear();

    await db.contributors.bulkPut([
      {
        id: 'contrib-1',
        order: 1,
        name: 'Pietro Bellotti',
        label: 'Stipendio',
        active: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
      {
        id: 'contrib-2',
        order: 2,
        name: 'Contributore 2',
        label: 'Stipendio',
        active: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
    ]);

    // Inserisci un'entrata collegata a contrib-2
    await db.incomeEntries.add({
      id: 'inc-test-1',
      contributorId: 'contrib-2',
      type: 'salary',
      amount: 1200,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: false,
      status: 'received',
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    });

    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/contributors']}>
          <Routes>
            <Route path="/settings/contributors" element={<ContributorsSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Pietro Bellotti')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Contributore 2')).toBeInTheDocument();
    });
  });

  it('8. Supporto e Contatti continua a funzionare dalla pagina Impostazioni', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/contact" element={<ContactPage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Supporto/i })).toBeInTheDocument();
    });

    const contactLink = screen.getByRole('link', { name: /Supporto/i });
    await act(async () => {
      fireEvent.click(contactLink);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Supporto e Contatti' })).toBeInTheDocument();
      expect(screen.getByLabelText(/^Messaggio/i)).toBeInTheDocument();
    });
  });

  it('9. Pagina Licenza software: rendering di LicenseSettingsCard, Condizioni generali e Informativa Privacy', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/license']}>
          <Routes>
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Licenza software' })).toBeInTheDocument();
    });

    // 1. LicenseSettingsCard
    expect(screen.getByText('Licenza Software')).toBeInTheDocument();
    expect(screen.getByText('Codice di Attivazione Licenza')).toBeInTheDocument();

    // 2. Condizioni generali e Licenza d'uso
    expect(screen.getByText("Condizioni generali e Licenza d'uso")).toBeInTheDocument();

    // 3. Informativa Privacy
    expect(screen.getByText('Informativa Privacy')).toBeInTheDocument();
  });

  it('10. Pagina Licenza: presenza avvisi BOZZA e testi segnaposto Lorem ipsum', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/license']}>
          <Routes>
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Licenza software' })).toBeInTheDocument();
    });

    // Entrambe le card mostrano chiaramente l'avviso BOZZA
    const draftNotices = screen.getAllByText('BOZZA — Testo definitivo in fase di definizione');
    expect(draftNotices).toHaveLength(2);

    // Entrambe le aree di testo contengono testo Lorem ipsum
    const loremTexts = screen.getAllByText(/Lorem ipsum dolor sit amet/i);
    expect(loremTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('11. Pagina Licenza: presenza delle due checkbox grafiche e loro interazione indipendente', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/license']}>
          <Routes>
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Licenza software' })).toBeInTheDocument();
    });

    const termsCheckbox = screen.getByRole('checkbox', {
      name: /Ho letto e accetto le Condizioni generali e la Licenza d'uso/i,
    }) as HTMLInputElement;
    const privacyCheckbox = screen.getByRole('checkbox', {
      name: /Dichiaro di aver preso visione dell'Informativa Privacy/i,
    }) as HTMLInputElement;

    expect(termsCheckbox).toBeInTheDocument();
    expect(termsCheckbox.checked).toBe(false);

    expect(privacyCheckbox).toBeInTheDocument();
    expect(privacyCheckbox.checked).toBe(false);

    // Toggle checkbox condizioni
    await act(async () => {
      fireEvent.click(termsCheckbox);
    });
    expect(termsCheckbox.checked).toBe(true);
    expect(privacyCheckbox.checked).toBe(false);

    // Toggle checkbox privacy
    await act(async () => {
      fireEvent.click(privacyCheckbox);
    });
    expect(termsCheckbox.checked).toBe(true);
    expect(privacyCheckbox.checked).toBe(true);
  });

  it('12. Le checkbox NON interferiscono con il funzionamento dell’attivazione licenza', async () => {
    render(
      <LicenseProvider>
        <MemoryRouter initialEntries={['/settings/license']}>
          <Routes>
            <Route path="/settings/license" element={<LicensePage />} />
          </Routes>
        </MemoryRouter>
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Codice di Attivazione Licenza')).toBeInTheDocument();
    });

    const activateBtn = screen.getByRole('button', { name: /Attiva Licenza/i });
    expect(activateBtn).toBeInTheDocument();

    const termsCheckbox = screen.getByRole('checkbox', {
      name: /Ho letto e accetto le Condizioni generali e la Licenza d'uso/i,
    }) as HTMLInputElement;

    // Anche se la checkbox non è selezionata, il form dell'attivazione si comporta normalmente senza dipendere da essa
    expect(termsCheckbox.checked).toBe(false);

    // Inserimento codice vuoto/spazi mostra validazione normale del modulo licenza
    const input = screen.getByPlaceholderText(/Es\. ABCD-EFGH-JKMN-PQRQ/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'ABCD-EFGH-JKMN-PQ' } });
    });

    expect(activateBtn).not.toBeDisabled();
  });
});
