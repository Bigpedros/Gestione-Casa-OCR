import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { LicenseRecord, PublicLicenseInfo } from '../types/license';
import { licenseService, DEFAULT_LICENSE_RECORD } from '../services/licenseService';

interface LicenseContextType {
  licenseState: LicenseRecord;
  licenseInfo: PublicLicenseInfo;
  isLoading: boolean;
  activateLicense: (data: Partial<LicenseRecord>) => void;
  deactivateLicense: () => void;
  refreshLicenseState: () => void;
}

const defaultInfo: PublicLicenseInfo = {
  licenseId: '',
  licenseType: 'beta_60_days',
  status: 'not_activated',
  remainingDays: null,
  expirationDate: null,
  owner: '',
  isActive: false,
};

export const LicenseContext = createContext<LicenseContextType>({
  licenseState: DEFAULT_LICENSE_RECORD,
  licenseInfo: defaultInfo,
  isLoading: true,
  activateLicense: () => {},
  deactivateLicense: () => {},
  refreshLicenseState: () => {},
});

export const LicenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [licenseState, setLicenseState] = useState<LicenseRecord>(DEFAULT_LICENSE_RECORD);
  const [licenseInfo, setLicenseInfo] = useState<PublicLicenseInfo>(defaultInfo);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshLicenseState = useCallback(() => {
    const currentState = licenseService.getState();
    const info = licenseService.getInfo();
    setLicenseState(currentState);
    setLicenseInfo(info);
  }, []);

  useEffect(() => {
    let isMounted = true;
    licenseService.initialize().then((state) => {
      if (isMounted) {
        setLicenseState(state);
        setLicenseInfo(licenseService.getInfo());
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const activateLicense = useCallback(
    (data: Partial<LicenseRecord>) => {
      const updated = licenseService.activate(data);
      setLicenseState(updated);
      setLicenseInfo(licenseService.getInfo());
    },
    []
  );

  const deactivateLicense = useCallback(() => {
    const updated = licenseService.deactivate();
    setLicenseState(updated);
    setLicenseInfo(licenseService.getInfo());
  }, []);

  return (
    <LicenseContext.Provider
      value={{
        licenseState,
        licenseInfo,
        isLoading,
        activateLicense,
        deactivateLicense,
        refreshLicenseState,
      }}
    >
      {children}
    </LicenseContext.Provider>
  );
};

export const useLicenseContext = () => useContext(LicenseContext);
