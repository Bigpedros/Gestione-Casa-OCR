import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db } from '../database/db';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { LicenseProvider } from '../context/LicenseContext';
import { ThemeProvider } from '../context/ThemeContext';
import { AppLayout } from '../components/layout/AppLayout';
import { HomePage } from '../features/home/HomePage';
import { IncomePage } from '../features/income/IncomePage';
import { ExpensesPage } from '../features/expenses/ExpensesPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { FixedExpensesPage } from '../features/fixed-expenses/FixedExpensesPage';
import { SavingsPage } from '../features/savings/SavingsPage';
import { SuppliersPage } from '../features/suppliers/SuppliersPage';
import { AttachmentsPage } from '../features/attachments/AttachmentsPage';
import { BackupPage } from '../features/backup/BackupPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { GeneralSettingsPage } from '../features/settings/GeneralSettingsPage';
import { ContributorsSettingsPage } from '../features/settings/ContributorsSettingsPage';
import { CategoriesSettingsPage } from '../features/settings/CategoriesSettingsPage';
import { OcrSettingsPage } from '../features/settings/OcrSettingsPage';
import { NotificationsSettingsPage } from '../features/settings/NotificationsSettingsPage';
import { AppearanceSettingsPage } from '../features/settings/AppearanceSettingsPage';
import { ModulesSettingsPage } from '../features/settings/ModulesSettingsPage';
import { LicensePage } from '../features/settings/LicensePage';
import { ContactPage } from '../features/settings/ContactPage';
import { ROUTES } from '../app/routes';

const ALL_12_DESTINATIONS = [
  { name: 'Generali', path: ROUTES.SETTINGS_GENERAL },
  { name: 'Contributori', path: ROUTES.SETTINGS_CONTRIBUTORS },
  { name: 'Categorie', path: ROUTES.SETTINGS_CATEGORIES },
  { name: 'Fornitori', path: ROUTES.SUPPLIERS },
  { name: 'OCR', path: ROUTES.SETTINGS_OCR },
  { name: 'Notifiche', path: ROUTES.SETTINGS_NOTIFICATIONS },
  { name: 'Aspetto', path: ROUTES.SETTINGS_APPEARANCE },
  { name: 'Moduli', path: ROUTES.SETTINGS_MODULES },
  { name: 'Backup', path: ROUTES.BACKUP },
  { name: 'Allegati', path: ROUTES.ATTACHMENTS },
  { name: 'Licenza', path: ROUTES.LICENSE },
  { name: 'Supporto', path: ROUTES.CONTACT },
];

function renderWithAppRoutes(initialRoute: string) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <ThemeProvider>
        <LicenseProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path={ROUTES.HOME} element={<HomePage />} />
              <Route path={ROUTES.INCOME} element={<IncomePage />} />
              <Route path={ROUTES.EXPENSES} element={<ExpensesPage />} />
              <Route path={ROUTES.PROJECTS} element={<ProjectsPage />} />
              <Route path={ROUTES.REPORTS} element={<ReportsPage />} />
              <Route path={ROUTES.FIXED_EXPENSES} element={<FixedExpensesPage />} />
              <Route path={ROUTES.SAVINGS} element={<SavingsPage />} />
              <Route path={ROUTES.SUPPLIERS} element={<SuppliersPage />} />
              <Route path={ROUTES.ATTACHMENTS} element={<AttachmentsPage />} />
              <Route path={ROUTES.BACKUP} element={<BackupPage />} />
              <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
              <Route path={ROUTES.SETTINGS_GENERAL} element={<GeneralSettingsPage />} />
              <Route path={ROUTES.SETTINGS_CONTRIBUTORS} element={<ContributorsSettingsPage />} />
              <Route path={ROUTES.SETTINGS_CATEGORIES} element={<CategoriesSettingsPage />} />
              <Route path={ROUTES.SETTINGS_OCR} element={<OcrSettingsPage />} />
              <Route path={ROUTES.SETTINGS_NOTIFICATIONS} element={<NotificationsSettingsPage />} />
              <Route path={ROUTES.SETTINGS_APPEARANCE} element={<AppearanceSettingsPage />} />
              <Route path={ROUTES.SETTINGS_MODULES} element={<ModulesSettingsPage />} />
              <Route path={ROUTES.LICENSE} element={<LicensePage />} />
              <Route path={ROUTES.CONTACT} element={<ContactPage />} />
            </Route>
          </Routes>
        </LicenseProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Settings Destinations Gabbia B & Primary Sidebar Layout', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.contributors.clear();
    await db.categories.clear();
    await db.suppliers.clear();
    await db.attachments.clear();
    await db.expenses.clear();
    await seedInitialCategoriesAndSettings();
  });

  describe('12 Settings Destination Pages (Gabbia B Specification)', () => {
    ALL_12_DESTINATIONS.forEach(({ name, path }) => {
      it(`[${name}] ${path}: should have NO sidebar, global header, Torna a Impostazioni, and navigate back to /settings`, async () => {
        const { container } = renderWithAppRoutes(path);

        // 1. Header globale presente
        await waitFor(() => {
          expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
        });

        // 2. Sidebar assente (Gabbia B)
        const sidebar = container.querySelector('aside');
        expect(sidebar).toBeNull();

        // 3. Comando "Torna a Impostazioni" presente
        const backButtons = screen.getAllByRole('link', { name: /Torna a Impostazioni/i });
        expect(backButtons.length).toBeGreaterThan(0);
        const backButton = backButtons[0];
        expect(backButton).toBeInTheDocument();
        expect(backButton.getAttribute('href')).toBe('/settings');

        // 4. Ritorno corretto a /settings con ripristino della sidebar
        await act(async () => {
          fireEvent.click(backButton);
        });

        // Verifichiamo che siamo tornati all'hub Impostazioni
        await waitFor(() => {
          expect(screen.getByText(/1\. Gestione della Casa/i)).toBeInTheDocument();
        });
        // Sull'hub /settings la sidebar è presente
        const settingsSidebar = container.querySelector('aside');
        expect(settingsSidebar).not.toBeNull();
      });
    });
  });

  describe('Three Focus Hotfix Pages: Direct URL load and return', () => {
    it('/backup: direct load has no sidebar, contains Torna a Impostazioni and returns to /settings', async () => {
      const { container } = renderWithAppRoutes(ROUTES.BACKUP);

      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      });
      expect(container.querySelector('aside')).toBeNull();
      expect(screen.getByText('Backup e Ripristino Dati')).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /Torna a Impostazioni/i });
      expect(backLink).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(backLink);
      });
      await waitFor(() => {
        expect(screen.getByText(/1\. Gestione della Casa/i)).toBeInTheDocument();
      });
      expect(container.querySelector('aside')).not.toBeNull();
    });

    it('/attachments: direct load has no sidebar, contains Torna a Impostazioni and returns to /settings', async () => {
      const { container } = renderWithAppRoutes(ROUTES.ATTACHMENTS);

      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      });
      expect(container.querySelector('aside')).toBeNull();
      expect(screen.getByText('Allegati e Ricevute Scontrini')).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /Torna a Impostazioni/i });
      expect(backLink).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(backLink);
      });
      await waitFor(() => {
        expect(screen.getByText(/1\. Gestione della Casa/i)).toBeInTheDocument();
      });
      expect(container.querySelector('aside')).not.toBeNull();
    });

    it('/suppliers: direct load has no sidebar, contains Torna a Impostazioni and returns to /settings', async () => {
      const { container } = renderWithAppRoutes(ROUTES.SUPPLIERS);

      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      });
      expect(container.querySelector('aside')).toBeNull();
      expect(screen.getByText('Anagrafica Fornitori')).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /Torna a Impostazioni/i });
      expect(backLink).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(backLink);
      });
      await waitFor(() => {
        expect(screen.getByText(/1\. Gestione della Casa/i)).toBeInTheDocument();
      });
      expect(container.querySelector('aside')).not.toBeNull();
    });
  });

  describe('Primary Hub & Main Application Pages (Sidebar Presence)', () => {
    it('/settings hub must KEEP the primary desktop sidebar and display all 12 cards', async () => {
      const { container } = renderWithAppRoutes(ROUTES.SETTINGS);

      // Header present
      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      });
      // Sidebar present on /settings
      const sidebar = container.querySelector('aside');
      expect(sidebar).not.toBeNull();

      // All 3 macro-sections
      expect(screen.getByText(/1\. Gestione della Casa/i)).toBeInTheDocument();
      expect(screen.getByText(/2\. Esperienza e Funzionalità/i)).toBeInTheDocument();
      expect(screen.getByText(/3\. Dati e Assistenza/i)).toBeInTheDocument();

      // All 12 cards present by heading and link
      const expectedCards = [
        { title: 'Generali', href: ROUTES.SETTINGS_GENERAL },
        { title: 'Contributori', href: ROUTES.SETTINGS_CONTRIBUTORS },
        { title: 'Categorie', href: ROUTES.SETTINGS_CATEGORIES },
        { title: 'Fornitori', href: ROUTES.SUPPLIERS },
        { title: 'OCR', href: ROUTES.SETTINGS_OCR },
        { title: 'Notifiche', href: ROUTES.SETTINGS_NOTIFICATIONS },
        { title: 'Aspetto', href: ROUTES.SETTINGS_APPEARANCE },
        { title: 'Moduli', href: ROUTES.SETTINGS_MODULES },
        { title: 'Backup', href: ROUTES.BACKUP },
        { title: 'Allegati', href: ROUTES.ATTACHMENTS },
        { title: 'Licenza', href: ROUTES.LICENSE },
        { title: 'Supporto', href: ROUTES.CONTACT },
      ];

      for (const card of expectedCards) {
        expect(screen.getByRole('heading', { name: card.title })).toBeInTheDocument();
        const cardLink = container.querySelector(`a[href="${card.href}"]`);
        expect(cardLink).not.toBeNull();
      }
    });

    const MAIN_APP_PAGES = [
      { name: 'Home', path: ROUTES.HOME },
      { name: 'Income', path: ROUTES.INCOME },
      { name: 'Expenses', path: ROUTES.EXPENSES },
      { name: 'Projects', path: ROUTES.PROJECTS },
      { name: 'Reports', path: ROUTES.REPORTS },
    ];

    MAIN_APP_PAGES.forEach(({ name, path }) => {
      it(`[${name}] ${path}: should have the primary desktop sidebar visible`, async () => {
        const { container } = renderWithAppRoutes(path);

        await waitFor(() => {
          expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
        });
        const sidebar = container.querySelector('aside');
        expect(sidebar).not.toBeNull();
      });
    });
  });
});

