import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Button } from '../../components/common';
import { Key, ArrowLeft } from 'lucide-react';
import { LicenseSettingsCard } from './components/LicenseSettingsCard';
import { TermsAndConditionsCard } from './components/TermsAndConditionsCard';
import { PrivacyPolicyCard } from './components/PrivacyPolicyCard';
import { ROUTES } from '../../app/routes';

export const LicensePage: React.FC = () => {
  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<Key className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Licenza software"
        subtitle="Gestione stato licenza, validazione certificata e associazione dispositivo per Gestione Casa OCR."
        actions={
          <Link to={ROUTES.SETTINGS}>
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Torna alle Impostazioni
            </Button>
          </Link>
        }
      />

      {/* 1. Componente di gestione licenza consolidato */}
      <LicenseSettingsCard />

      {/* 2. Riquadro Condizioni generali e Licenza d'uso */}
      <TermsAndConditionsCard />

      {/* 3. Riquadro Informativa Privacy */}
      <PrivacyPolicyCard />
    </div>
  );
};
