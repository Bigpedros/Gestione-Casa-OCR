import { createBrowserRouter } from 'react-router-dom';
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
import { ROUTES } from './routes';

export const router = createBrowserRouter([
  {
    path: ROUTES.HOME,
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: ROUTES.INCOME, element: <IncomePage /> },
      { path: ROUTES.EXPENSES, element: <ExpensesPage /> },
      { path: ROUTES.PROJECTS, element: <ProjectsPage /> },
      { path: ROUTES.REPORTS, element: <ReportsPage /> },
      { path: ROUTES.FIXED_EXPENSES, element: <FixedExpensesPage /> },
      { path: ROUTES.SAVINGS, element: <SavingsPage /> },
      { path: ROUTES.SUPPLIERS, element: <SuppliersPage /> },
      { path: ROUTES.ATTACHMENTS, element: <AttachmentsPage /> },
      { path: ROUTES.BACKUP, element: <BackupPage /> },
      { path: ROUTES.SETTINGS, element: <SettingsPage /> },
      { path: ROUTES.SETTINGS_GENERAL, element: <GeneralSettingsPage /> },
      { path: ROUTES.SETTINGS_CONTRIBUTORS, element: <ContributorsSettingsPage /> },
      { path: ROUTES.SETTINGS_CATEGORIES, element: <CategoriesSettingsPage /> },
      { path: ROUTES.SETTINGS_OCR, element: <OcrSettingsPage /> },
      { path: ROUTES.SETTINGS_NOTIFICATIONS, element: <NotificationsSettingsPage /> },
      { path: ROUTES.SETTINGS_APPEARANCE, element: <AppearanceSettingsPage /> },
      { path: ROUTES.SETTINGS_MODULES, element: <ModulesSettingsPage /> },
      { path: ROUTES.LICENSE, element: <LicensePage /> },
      { path: ROUTES.CONTACT, element: <ContactPage /> },
    ],
  },
]);
