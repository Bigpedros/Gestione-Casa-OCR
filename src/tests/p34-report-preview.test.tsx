import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { db } from '../database/db';
import { ReportsPage } from '../features/reports/ReportsPage';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('P-34: Anteprima del Report economico (UI R02)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('TEST 1 – Presenza e accessibilità dei pulsanti di azione della testata e dell\'anteprima', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Crea report/i });
    const openSavedBtn = screen.getByRole('button', { name: /Apri report salvato/i });
    const printBtn = screen.getByRole('button', { name: /Stampa il report visualizzato/i });
    const exportPdfBtn = screen.getByRole('button', { name: /Esporta o Stampa in PDF/i });
    const saveBtn = screen.getByRole('button', { name: /Salva questo report/i });
    const closeMonthBtn = screen.getByRole('button', { name: /Chiudi Mese/i });

    expect(createBtn).toBeInTheDocument();
    expect(openSavedBtn).toBeInTheDocument();
    expect(printBtn).toBeInTheDocument();
    expect(exportPdfBtn).toBeInTheDocument();
    expect(saveBtn).toBeInTheDocument();
    expect(closeMonthBtn).toBeInTheDocument();
    expect(closeMonthBtn).toBeDisabled();
  });

  it('TEST 2 & 3 – Anteprima integrata in tempo reale e coerenza contenuti', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText('Anteprima report')).toBeInTheDocument();
      expect(screen.getByText('Totale Entrate')).toBeInTheDocument();
      expect(screen.getByText('Totale Uscite')).toBeInTheDocument();
      expect(screen.getByText('Saldo del Periodo')).toBeInTheDocument();
    });

    // Check presence of the report document preview
    expect(screen.getAllByText(/Report Economico/i).length).toBeGreaterThan(0);
  });

  it('TEST 4, 5 & 6 – Paginazione e azioni di stampa del report', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText('Pagina 1: Sintesi Economica')).toBeInTheDocument();
    });

    const page2Btn = screen.getByText('Pagina 2: Dettagli & Ripartizioni');
    expect(page2Btn).toBeInTheDocument();

    // Switch to Page 2
    fireEvent.click(page2Btn);
    await waitFor(() => {
      expect(screen.getByText('Pagina 2 di 2')).toBeInTheDocument();
    });

    // Switch back to Page 1
    const page1Btn = screen.getByText('Pagina 1: Sintesi Economica');
    fireEvent.click(page1Btn);
    await waitFor(() => {
      expect(screen.getByText('Pagina 1 di 2')).toBeInTheDocument();
    });

    // Trigger Print
    const printBtn = screen.getByRole('button', { name: /Stampa il report visualizzato/i });
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('TEST 7 – Scegli periodo incompleto mostra il messaggio di supporto', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
    });

    const selectPeriod = screen.getByLabelText('Periodo del report');
    fireEvent.change(selectPeriod, { target: { value: 'choose_period' } });

    await waitFor(() => {
      expect(screen.getByLabelText('Mese da analizzare')).toBeInTheDocument();
    });

    // The prompt is shown when month is not selected
    await waitFor(() => {
      expect(screen.getByText('Seleziona il mese per generare il report.')).toBeInTheDocument();
    });
  });
});
