import { useLicenseContext } from '../context/LicenseContext';

export function useLicense() {
  const context = useLicenseContext();
  if (!context) {
    throw new Error('useLicense deve essere utilizzato all\'interno di un LicenseProvider');
  }

  return context;
}

