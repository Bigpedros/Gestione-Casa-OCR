import { useLicenseContext } from '../context/LicenseContext';

export function useLicense() {
  const context = useLicenseContext();
  if (!context) {
    throw new Error('useLicense deve essere utilizzato all\'interno di un LicenseProvider');
  }

  return {
    licenseState: context.licenseState,
    licenseInfo: context.licenseInfo,
    isLoading: context.isLoading,
    activateLicense: context.activateLicense,
    deactivateLicense: context.deactivateLicense,
    refreshLicenseState: context.refreshLicenseState,
  };
}
