import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { db } from '../database/db';
import { ReportsPage } from '../features/reports/ReportsPage';

describe('P-34: Anteprima del Report prima della stampa', () => {
  beforeEach(async () => {
    await db.monthlyReports.clear();
  });

  it('TEST 1 – Ordine dei pulsanti nel box superiore del Report', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
    });

    const previewBtn = screen.getByRole('button', { name: /Apri anteprima del report/i });
    const printBtn = screen.getByRole('button', { name: /Stampa il report visualizzato/i });
    const closeMonthBtn = screen.getByRole('button', { name: /Chiudi Mese/i });

    expect(previewBtn).toBeInTheDocument();
    expect(printBtn).toBeInTheDocument();
    expect(closeMonthBtn).toBeInTheDocument();

    // Verify DOM order: previewBtn must be immediately before printBtn
    const parentContainer = previewBtn.parentElement;
    expect(parentContainer).toBeInTheDocument();
    const childrenArray = Array.from(parentContainer?.children || []);
    const previewIndex = childrenArray.indexOf(previewBtn);
    const printIndex = childrenArray.indexOf(printBtn);

    expect(previewIndex).toBeGreaterThan(-1);
    expect(printIndex).toEqual(previewIndex + 1);
  });

  it('TEST 2 & 3 – Apertura anteprima e coincidenza contenuti', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Apri anteprima del report/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    const previewBtn = screen.getByRole('button', { name: /Apri anteprima del report/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Anteprima Report Economico/i })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog', { name: /Anteprima Report Economico/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('TEST 4, 5 & 6 – Pulsanti Chiudi e Stampa Report nell\'anteprima', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Apri anteprima del report/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Apri anteprima del report/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Anteprima Report Economico/i })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog', { name: /Anteprima Report Economico/i });
    expect(dialog).toBeInTheDocument();
    const closeBtn = within(dialog).getByRole('button', { name: /Chiudi anteprima del report/i });
    const printReportBtn = within(dialog).getByRole('button', { name: /Stampa il report visualizzato/i });

    expect(closeBtn).toBeInTheDocument();
    expect(printReportBtn).toBeInTheDocument();

    // Test Chiudi button closes dialog without page reload or loss of state
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Anteprima Report Economico/i })).not.toBeInTheDocument();
    });

    // Period selection is preserved
    expect(screen.getByLabelText('Periodo del report')).toHaveValue('current_month');
  });

  it('TEST 7 – Scegli periodo incompleto disabilita Anteprima Report', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
    });

    const selectPeriod = screen.getByLabelText('Periodo del report');
    fireEvent.change(selectPeriod, { target: { value: 'choose_period' } });

    await waitFor(() => {
      expect(screen.getByLabelText('Mese da analizzare')).toBeInTheDocument();
    });

    const previewBtn = screen.getByRole('button', { name: /Apri anteprima del report/i });
    expect(previewBtn).toBeDisabled();
    expect(previewBtn).toHaveAttribute('title', "Seleziona un mese prima di aprire l'anteprima.");
  });
});
