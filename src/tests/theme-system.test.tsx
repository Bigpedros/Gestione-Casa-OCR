import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { AppearanceSettingsPage } from '../features/settings/AppearanceSettingsPage';
import { Sidebar } from '../components/navigation/Sidebar';
import { Header } from '../components/navigation/Header';
import { db } from '../database/db';
import { settingsRepository } from '../repositories';

// Helper component to test useTheme hook directly
const TestThemeConsumer: React.FC = () => {
  const { themeMode, setThemeMode } = useTheme();
  return (
    <div>
      <span data-testid="theme-mode">{themeMode}</span>
      <button onClick={() => setThemeMode('light')} data-testid="btn-light">Set Light</button>
      <button onClick={() => setThemeMode('pearl')} data-testid="btn-pearl">Set Pearl</button>
      <button onClick={() => setThemeMode('dark')} data-testid="btn-dark">Set Dark</button>
    </div>
  );
};

describe('Fase 8.3C - Sistema Globale dei Temi (Perla Default / Chiaro Sabbia / Scuro Antracite)', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-palette');

    // Assicura che le impostazioni esistano nel database con chiave 'default-settings'
    await db.settings.put({
      id: 'default-settings',
      userMode: 'single',
      contributorsCount: 1,
      currency: 'EUR',
      language: 'it-IT',
      budgetMode: 'prudential',
      monthlyBudgetSource: 'manualContributorIncome',
      includePaidExpensesInBudget: true,
      includeNotifiedPlannedExpensesInBudget: true,
      includeSavingPlansInBudget: true,
      includeProjectQuotasInBudget: true,
      extraBudgetUsage: 'coverDeficitOnly',
      reportClosingMode: 'automaticEndOfMonth',
      reportClosingTime: '23:59',
      attachmentRetentionMonths: 12,
      theme: 'pearl',
      notificationsEnabled: true,
      notificationAdvanceDays: 3,
      homeAddress: { address: '', streetNumber: '', postalCode: '' },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });
  });

  it('1. Perla come valore predefinito: inizializza con palette Perla, no dark class', async () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-mode').textContent).toBe('pearl');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
    expect(document.documentElement.getAttribute('data-palette')).toBe('pearl');
  });

  it('2. Migrazione automatica da legacy "system" a "pearl" in localStorage e Dexie', async () => {
    localStorage.setItem('gestione_casa_theme', 'system');
    await db.settings.put({
      id: 'default-settings',
      userMode: 'single',
      contributorsCount: 1,
      currency: 'EUR',
      language: 'it-IT',
      budgetMode: 'prudential',
      monthlyBudgetSource: 'manualContributorIncome',
      includePaidExpensesInBudget: true,
      includeNotifiedPlannedExpensesInBudget: true,
      includeSavingPlansInBudget: true,
      includeProjectQuotasInBudget: true,
      extraBudgetUsage: 'coverDeficitOnly',
      reportClosingMode: 'automaticEndOfMonth',
      reportClosingTime: '23:59',
      attachmentRetentionMonths: 12,
      theme: 'system' as any,
      notificationsEnabled: true,
      notificationAdvanceDays: 3,
      homeAddress: { address: '', streetNumber: '', postalCode: '' },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });

    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('theme-mode').textContent).toBe('pearl');
      expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
      expect(document.documentElement.getAttribute('data-palette')).toBe('pearl');
      expect(localStorage.getItem('gestione_casa_theme')).toBe('pearl');
    });

    await waitFor(async () => {
      const saved = await settingsRepository.get();
      expect(saved.theme).toBe('pearl');
    });
  });

  it('3. Selezione e persistenza di Chiaro (Sabbia)', async () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId('btn-light'));

    await waitFor(() => {
      expect(screen.getByTestId('theme-mode').textContent).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.getAttribute('data-palette')).toBe('sand');
      expect(localStorage.getItem('gestione_casa_theme')).toBe('light');
    });

    await waitFor(async () => {
      const savedSettings = await settingsRepository.get();
      expect(savedSettings.theme).toBe('light');
    });
  });

  it('4. Selezione e persistenza di Perla (Default)', async () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    // Prima passa a dark poi torna a pearl
    fireEvent.click(screen.getByTestId('btn-dark'));
    await waitFor(() => expect(screen.getByTestId('theme-mode').textContent).toBe('dark'));

    fireEvent.click(screen.getByTestId('btn-pearl'));

    await waitFor(() => {
      expect(screen.getByTestId('theme-mode').textContent).toBe('pearl');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
      expect(document.documentElement.getAttribute('data-palette')).toBe('pearl');
      expect(localStorage.getItem('gestione_casa_theme')).toBe('pearl');
    });

    await waitFor(async () => {
      const savedSettings = await settingsRepository.get();
      expect(savedSettings.theme).toBe('pearl');
    });
  });

  it('5. Selezione e persistenza di Scuro (Antracite)', async () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId('btn-dark'));

    await waitFor(() => {
      expect(screen.getByTestId('theme-mode').textContent).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-palette')).toBe('anthracite');
      expect(localStorage.getItem('gestione_casa_theme')).toBe('dark');
    });

    await waitFor(async () => {
      const savedSettings = await settingsRepository.get();
      expect(savedSettings.theme).toBe('dark');
    });
  });

  it('6-7. Autonomia e nessuna reazione al cambio preferenza del sistema operativo', async () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    // Default pearl
    expect(screen.getByTestId('theme-mode').textContent).toBe('pearl');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Dispatchevent su window o matchMedia non deve alterare la palette attiva
    window.dispatchEvent(new Event('change'));

    expect(screen.getByTestId('theme-mode').textContent).toBe('pearl');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('11-15. Pagina Aspetto: 3 card (Chiaro, Perla, Scuro), badge attivi, radiogroup accessibile e Gabbia B', async () => {
    render(
      <ThemeProvider>
        <BrowserRouter>
          <AppearanceSettingsPage />
        </BrowserRouter>
      </ThemeProvider>
    );

    // Titolo, breadcrumbs e Gabbia B (Torna a Impostazioni)
    expect(screen.getByText('Aspetto e Tema Visivo')).toBeInTheDocument();
    expect(screen.getByText('Torna a Impostazioni')).toBeInTheDocument();

    // Radiogroup e le 3 opzioni
    const radiogroup = screen.getByRole('radiogroup', { name: 'Selezione tema visivo' });
    expect(radiogroup).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(3);

    // Opzioni: Chiaro (Sabbia), Perla (DEFAULT), Scuro (Antracite)
    expect(screen.getByText('Chiaro')).toBeInTheDocument();
    expect(screen.getByText('Sabbia')).toBeInTheDocument();
    expect(screen.getByText('Perla')).toBeInTheDocument();
    expect(screen.getByText('DEFAULT')).toBeInTheDocument();
    expect(screen.getByText('Scuro')).toBeInTheDocument();
    expect(screen.getByText('Antracite')).toBeInTheDocument();

    // Testo card Perla
    expect(screen.getByText(/Palette neutra e luminosa sui toni del grigio perla/i)).toBeInTheDocument();

    // Default attivo: Perla
    expect(screen.getByText('Tema Attivo: Perla')).toBeInTheDocument();
    expect(radios[1].getAttribute('aria-checked')).toBe('true');

    // Selezione di Scuro tramite click sulla card
    const scuroCard = radios[2];
    fireEvent.click(scuroCard);

    await waitFor(() => {
      expect(scuroCard.getAttribute('aria-checked')).toBe('true');
      expect(radios[1].getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText('Tema Attivo: Scuro')).toBeInTheDocument();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-palette')).toBe('anthracite');
    });

    // Selezione di Chiaro tramite tastiera (Enter)
    const chiaroCard = radios[0];
    fireEvent.keyDown(chiaroCard, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(chiaroCard.getAttribute('aria-checked')).toBe('true');
      expect(scuroCard.getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText('Tema Attivo: Chiaro')).toBeInTheDocument();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.getAttribute('data-palette')).toBe('sand');
    });

    // Selezione di Perla tramite tastiera (Spazio)
    const perlaCard = radios[1];
    fireEvent.keyDown(perlaCard, { key: ' ', code: 'Space' });

    await waitFor(() => {
      expect(perlaCard.getAttribute('aria-checked')).toBe('true');
      expect(chiaroCard.getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText('Tema Attivo: Perla')).toBeInTheDocument();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
      expect(document.documentElement.getAttribute('data-palette')).toBe('pearl');
    });
  });

  it('16. Sidebar & Header: Contrasto e classi cromatiche nel tema Scuro - Antracite e integrità 6 voci', async () => {
    // Configura tema dark
    await db.settings.put({
      id: 'default-settings',
      userMode: 'single',
      contributorsCount: 1,
      currency: 'EUR',
      language: 'it-IT',
      budgetMode: 'prudential',
      monthlyBudgetSource: 'manualContributorIncome',
      includePaidExpensesInBudget: true,
      includeNotifiedPlannedExpensesInBudget: true,
      includeSavingPlansInBudget: true,
      includeProjectQuotasInBudget: true,
      extraBudgetUsage: 'coverDeficitOnly',
      reportClosingMode: 'automaticEndOfMonth',
      reportClosingTime: '23:59',
      attachmentRetentionMonths: 12,
      theme: 'dark',
      notificationsEnabled: true,
      notificationAdvanceDays: 3,
      homeAddress: { address: '', streetNumber: '', postalCode: '' },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });
    localStorage.setItem('gestione_casa_theme', 'dark');

    const { container } = render(
      <ThemeProvider>
        <BrowserRouter>
          <Header />
          <Sidebar />
        </BrowserRouter>
      </ThemeProvider>
    );

    // 1. Verifica che il tema scuro sia applicato
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBe('anthracite');

    // 2. Verifica Header: Nome "Gestione Casa" (#F2EDE2) e Payoff (#CAC4B8)
    const headerTitle = screen.getByRole('heading', { level: 1, name: 'Gestione Casa' });
    expect(headerTitle).toBeInTheDocument();
    expect(headerTitle.className).toContain('dark:text-[#F2EDE2]');

    const headerPayoff = screen.getByText('Tutto sotto controllo, casa e budget in equilibrio.');
    expect(headerPayoff).toBeInTheDocument();
    expect(headerPayoff.className).toContain('dark:text-[#CAC4B8]');

    // 3. Verifica presenza, etichette e ordine di tutte le 6 voci della sidebar
    const expectedLabels = [
      'Home',
      'Entrate',
      'Uscite',
      'Progetti e Risparmi',
      'Report',
      'Impostazioni',
    ];

    const navLinks = container.querySelectorAll('aside nav a, aside a');
    expect(navLinks.length).toBe(6);

    expectedLabels.forEach((label, idx) => {
      expect(navLinks[idx]).toHaveTextContent(label);
    });

    // 4. Verifica contrasto voce attiva (Home è su '/')
    const activeLink = navLinks[0];
    expect(activeLink.className).toContain('dark:bg-[#E5DCCB]');
    expect(activeLink.className).toContain('dark:text-[#4F46E5]');

    const activeIcon = activeLink.querySelector('svg');
    expect(activeIcon).not.toBeNull();
    expect(activeIcon?.getAttribute('class')).toContain('dark:text-[#4F46E5]');

    // 5. Verifica contrasto voci inattive (es. Entrate, Uscite, etc.)
    const inactiveLink = navLinks[1]; // Entrate
    expect(inactiveLink.className).toContain('dark:text-[#CAC4B8]');
    expect(inactiveLink.className).toContain('dark:hover:bg-[#2D3238]');
    expect(inactiveLink.className).toContain('dark:hover:text-[#F2EDE2]');

    // 6. Verifica contrasto icone inattive (#A9B1BC) e hover (#F2EDE2)
    const inactiveIcon = inactiveLink.querySelector('svg');
    expect(inactiveIcon).not.toBeNull();
    expect(inactiveIcon?.getAttribute('class')).toContain('dark:text-[#A9B1BC]');
    expect(inactiveIcon?.getAttribute('class')).toContain('dark:group-hover:text-[#F2EDE2]');

    // 7. Verifica assenza di classi scure o illegibili su sfondo scuro
    expect(inactiveLink.className).not.toContain('text-black');
    expect(inactiveLink.className).not.toContain('dark:text-slate-900');
    expect(inactiveLink.className).not.toContain('dark:text-black');
  });
});

