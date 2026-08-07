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
      { path: ROUTES.CONTACT, element: <ContactPage /> },
    ],
  },
]);
