import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContactPage } from '../features/settings/ContactPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { contactRequestRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import {
  createContactRequestExchangeEnvelope,
  serializeContactRequestExchangeEnvelope,
  buildContactRequestExchangeFileName,
} from '@gestione-casa/shared-sdk';

describe('Sottofase 2.3.B.3 - Modulo UI Supporto e Contatti (/settings/contact)', () => {
  beforeEach(async () => {
    await contactRequestRepository.clear();
    await seedInitialCategoriesAndSettings();
  });

  afterEach(async () => {
    await contactRequestRepository.clear();
  });

  it('1 & 2: Renderizza la pagina e tutti i campi obbligatori del form', () => {
    render(
      <MemoryRouter initialEntries={['/settings/contact']}>
        <Routes>
          <Route path="/settings/contact" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Titolo e intestazione
    expect(screen.getByRole('heading', { name: 'Supporto e Contatti' })).toBeInTheDocument();

    // Campi obbligatori e controlli del form
    expect(screen.getByLabelText(/^Nome/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Cognome/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Telefono/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tipo di richiesta/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Canale di contatto preferito/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Oggetto \/ Titolo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Messaggio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Acconsento al trattamento dei dati personali/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salva richiesta in locale/i })).toBeInTheDocument();
  });

  it('3: Validazione consenso privacy obbligatorio', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/contact']}>
        <Routes>
          <Route path="/settings/contact" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Compila i campi di testo senza spuntare il consenso privacy
    fireEvent.change(screen.getByLabelText(/^Nome/i), { target: { value: 'Giuseppe' } });
    fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'giuseppe@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Oggetto \/ Titolo/i), { target: { value: 'Richiesta info' } });
    fireEvent.change(screen.getByLabelText(/^Messaggio/i), { target: { value: 'Messaggio di prova per privacy' } });

    // Submit form senza checkbox privacy
    const form = screen.getByRole('button', { name: /Salva richiesta in locale/i }).closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });

    // Errore privacy mostrato
    expect(screen.getByText(/consenso al trattamento dei dati/i)).toBeInTheDocument();
    expect(await contactRequestRepository.count()).toBe(0);
  });

  it('4: Validazione email errata', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/contact']}>
        <Routes>
          <Route path="/settings/contact" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/^Nome/i), { target: { value: 'Laura' } });
    fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'email-non-valida' } });
    fireEvent.change(screen.getByLabelText(/^Oggetto \/ Titolo/i), { target: { value: 'Titolo test' } });
    fireEvent.change(screen.getByLabelText(/^Messaggio/i), { target: { value: 'Messaggio con email errata' } });
    fireEvent.click(screen.getByLabelText(/Acconsento al trattamento dei dati personali/i));

    const form = screen.getByRole('button', { name: /Salva richiesta in locale/i }).closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });

    // Validazione fallisce via SDK / Form
    expect(await contactRequestRepository.count()).toBe(0);
  });

  it('5-14: Creazione richiesta valida con valori canonici e salvataggio locale tramite repository', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/contact']}>
        <Routes>
          <Route path="/settings/contact" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Compila modulo completo
    fireEvent.change(screen.getByLabelText(/^Nome/i), { target: { value: 'Mario' } });
    fireEvent.change(screen.getByLabelText(/^Cognome/i), { target: { value: 'Rossi' } });
    fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'mario.rossi@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Telefono/i), { target: { value: '+39 333 1234567' } });
    fireEvent.change(screen.getByLabelText(/^Tipo di richiesta/i), { target: { value: 'support' } });
    fireEvent.change(screen.getByLabelText(/^Canale di contatto preferito/i), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText(/^Oggetto \/ Titolo/i), { target: { value: 'Assistenza Scansione OCR' } });
    fireEvent.change(screen.getByLabelText(/^Messaggio/i), { target: { value: 'Ho un dubbio sulla categoria automatica' } });
    fireEvent.click(screen.getByLabelText(/Acconsento al trattamento dei dati personali/i));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Salva richiesta in locale/i }));
    });

    // 14. Conferma di successo mostrata a schermo
    await waitFor(() => {
      expect(screen.getByText(/Richiesta salvata correttamente\./i)).toBeInTheDocument();
    });

    // 13. Verifico salvataggio tramite repository
    const all = await contactRequestRepository.getAll();
    expect(all).toHaveLength(1);

    const doc = all[0];
    expect(doc.firstName).toBe('Mario');
    expect(doc.lastName).toBe('Rossi');
    expect(doc.displayName).toBe('Mario Rossi');
    expect(doc.email).toBe('mario.rossi@example.com');
    expect(doc.phone).toBe('+39 333 1234567');

    // 6. source = gestione_casa_ocr
    expect(doc.source).toBe('gestione_casa_ocr');

    // 7. status = new
    expect(doc.status).toBe('new');

    // 8. syncStatus = pending
    expect(doc.syncStatus).toBe('pending');

    // 9. schemaVersion = 1
    expect(doc.schemaVersion).toBe(1);

    // 10. metadata = {}
    expect(doc.metadata).toEqual({});

    // 11. linkedCustomerId = null
    expect(doc.linkedCustomerId).toBeNull();

    // 12. linkedLicenseId = null
    expect(doc.linkedLicenseId).toBeNull();
  });

  it('15-20: Esportazione JSON Envelope, filename generato dallo SDK e invio Mailto (syncStatus rimane pending)', async () => {
    // URL.createObjectURL mock per jsdom
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    render(
      <MemoryRouter initialEntries={['/settings/contact']}>
        <Routes>
          <Route path="/settings/contact" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/^Nome/i), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Oggetto \/ Titolo/i), { target: { value: 'Richiesta rinnovo' } });
    fireEvent.change(screen.getByLabelText(/^Messaggio/i), { target: { value: 'Vorrei rinnovare per un altro anno' } });
    fireEvent.click(screen.getByLabelText(/Acconsento al trattamento dei dati personali/i));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Salva richiesta in locale/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Richiesta salvata correttamente\./i)).toBeInTheDocument();
    });

    const storedList = await contactRequestRepository.getAll();
    const doc = storedList[0];

    // 15, 16, 17, 18: Verifica SDK Envelope & Filename
    const envelopeRes = createContactRequestExchangeEnvelope(doc);
    expect(envelopeRes.isValid).toBe(true);
    expect(envelopeRes.value?.format).toBe('gestione-casa-contact-request');
    expect(envelopeRes.value?.formatVersion).toBe(1);

    const serializedRes = serializeContactRequestExchangeEnvelope(envelopeRes.value!);
    expect(serializedRes.isValid).toBe(true);
    expect(serializedRes.value).toContain('gestione-casa-contact-request');

    const fileNameRes = buildContactRequestExchangeFileName(envelopeRes.value!);
    expect(fileNameRes.isValid).toBe(true);
    expect(fileNameRes.value).toMatch(/^gestione-casa-contact-request_req_/);

    // Clicca pulsante Esporta JSON
    const exportBtn = screen.getByRole('button', { name: /Esporta JSON richiesta/i });
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    // 19. Export non modifica syncStatus (rimane pending)
    const afterExportDoc = await contactRequestRepository.getById(doc.id);
    expect(afterExportDoc?.syncStatus).toBe('pending');

    // 20. Mailto non modifica syncStatus
    const mailtoBtn = screen.getByRole('button', { name: /Apri email/i });
    await act(async () => {
      fireEvent.click(mailtoBtn);
    });

    const afterMailtoDoc = await contactRequestRepository.getById(doc.id);
    expect(afterMailtoDoc?.syncStatus).toBe('pending');

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('21-23: Route /settings/contact e navigazione dalla pagina Impostazioni', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/contact" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Nella pagina Impostazioni è presente la card / pulsante "Supporto e Contatti"
    await waitFor(() => {
      expect(screen.getAllByText(/Supporto e Contatti/i).length).toBeGreaterThan(0);
    });

    const supportLink = screen.getByRole('button', { name: /Supporto e Contatti/i });
    expect(supportLink).toBeInTheDocument();

    // Naviga alla route /settings/contact
    await act(async () => {
      fireEvent.click(supportLink);
    });

    // Verifico caricamento ContactPage
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Supporto e Contatti' })).toBeInTheDocument();
      expect(screen.getByLabelText(/^Messaggio/i)).toBeInTheDocument();
    });
  });
});
