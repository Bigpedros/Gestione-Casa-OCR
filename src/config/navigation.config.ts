export interface NavItem {
  label: string;
  path: string;
  iconName: string;
}

export const MAIN_NAVIGATION: NavItem[] = [
  { label: 'Home', path: '/', iconName: 'Home' },
  { label: 'Entrate', path: '/income', iconName: 'TrendingUp' },
  { label: 'Uscite', path: '/expenses', iconName: 'TrendingDown' },
  { label: 'Progetti', path: '/projects', iconName: 'FolderKanban' },
  { label: 'Report', path: '/reports', iconName: 'FileText' },
];

export const SECONDARY_NAVIGATION: NavItem[] = [
  { label: 'Spese Fisse', path: '/fixed-expenses', iconName: 'Calendar' },
  { label: 'Risparmi', path: '/savings', iconName: 'PiggyBank' },
  { label: 'Fornitori', path: '/suppliers', iconName: 'Store' },
  { label: 'Allegati', path: '/attachments', iconName: 'Paperclip' },
  { label: 'Backup', path: '/backup', iconName: 'HardDrive' },
  { label: 'Impostazioni', path: '/settings', iconName: 'Settings' },
];
