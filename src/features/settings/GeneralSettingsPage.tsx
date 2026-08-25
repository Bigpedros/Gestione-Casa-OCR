import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { settingsRepository } from '../../repositories';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
} from '../../components/common';
import {
  Home,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Save,
  Globe,
  Coins,
} from 'lucide-react';
import type { HomeAddress } from '../../types';
import { ROUTES } from '../../app/routes';

export const GeneralSettingsPage: React.FC = () => {
  const [homeAddress, setHomeAddress] = useState<HomeAddress>({
    address: '',
    streetNumber: '',
    postalCode: '',
  });
  const [homeAddressError, setHomeAddressError] = useState<string | null>(null);
  const [homeAddressSavedMsg, setHomeAddressSavedMsg] = useState(false);

  useEffect(() => {
    settingsRepository.get().then((s) => {
      if (s.homeAddress) {
        setHomeAddress({
          address: s.homeAddress.address || '',
          streetNumber: s.homeAddress.streetNumber || '',
          postalCode: s.homeAddress.postalCode || '',
        });
      }
    }).catch(() => {});
  }, []);

  const handleSaveHomeAddress = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setHomeAddressError(null);

    const trimmedAddress = homeAddress.address.trim();
    const trimmedStreetNumber = homeAddress.streetNumber.trim();
    const trimmedPostalCode = homeAddress.postalCode.trim();

    // CAP validation: if provided, must be exactly 5 numeric digits
    if (trimmedPostalCode.length > 0) {
      const isFiveDigits = /^\d{5}$/.test(trimmedPostalCode);
      if (!isFiveDigits) {
        setHomeAddressError('Il CAP deve contenere esattamente 5 cifre.');
        return;
      }
    }

    try {
      const updatedAddress: HomeAddress = {
        address: trimmedAddress,
        streetNumber: trimmedStreetNumber,
        postalCode: trimmedPostalCode,
      };

      await settingsRepository.update({
        homeAddress: updatedAddress,
      });

      setHomeAddress(updatedAddress);
      setHomeAddressSavedMsg(true);
      setTimeout(() => setHomeAddressSavedMsg(false), 3000);
    } catch {
      setHomeAddressError('Impossibile salvare i dati dell’abitazione. Riprova.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        icon={<Home className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Impostazioni Generali e Abitazione"
        subtitle="Gestisci l'indirizzo della tua casa e le preferenze regionali dell'applicazione."
        actions={
          <Link to={ROUTES.SETTINGS}>
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Torna a Impostazioni
            </Button>
          </Link>
        }
      />

      {/* Breadcrumb back link */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Link
          to={ROUTES.SETTINGS}
          className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Impostazioni
        </Link>
        <span>/</span>
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Generali</span>
      </div>

      {/* Success Feedback */}
      {homeAddressSavedMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">Dati dell'abitazione salvati con successo.</span>
        </div>
      )}

      {/* Error Feedback */}
      {homeAddressError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="text-sm font-medium">{homeAddressError}</span>
        </div>
      )}

      {/* Sezione 1: Abitazione */}
      <DashboardCard>
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <Home className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Abitazione Principale
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dati di localizzazione dell'immobile di riferimento per la gestione familiare.
                </p>
              </div>
            </div>
            <Badge variant="info">Locale</Badge>
          </div>

          <form onSubmit={handleSaveHomeAddress} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-6 space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Indirizzo (Via, Viale, Piazza)
                </label>
                <input
                  type="text"
                  placeholder="Es. Via Roma"
                  value={homeAddress.address}
                  onChange={(e) => setHomeAddress({ ...homeAddress, address: e.target.value })}
                  className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="md:col-span-3 space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  N° Civico
                </label>
                <input
                  type="text"
                  placeholder="Es. 25/A"
                  value={homeAddress.streetNumber}
                  onChange={(e) => setHomeAddress({ ...homeAddress, streetNumber: e.target.value })}
                  className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="md:col-span-3 space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  CAP (5 cifre)
                </label>
                <input
                  type="text"
                  maxLength={5}
                  placeholder="Es. 00100"
                  value={homeAddress.postalCode}
                  onChange={(e) => setHomeAddress({ ...homeAddress, postalCode: e.target.value })}
                  className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                icon={<Save className="w-4 h-4" />}
              >
                Salva Indirizzo
              </Button>
            </div>
          </form>
        </div>
      </DashboardCard>

      {/* Sezione 2: Preferenze Regionali e Base */}
      <DashboardCard>
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Preferenze Regionali & Standard
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Formato valuta, lingua e parametri di calcolo predefiniti.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Lingua interfaccia</span>
                <Badge variant="neutral">Predefinita</Badge>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-500" />
                Italiano (Italia) - it-IT
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Valuta principale</span>
                <Badge variant="neutral">Standard</Badge>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-slate-500" />
                Euro (€ - EUR)
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Modello di Bilancio</span>
                <Badge variant="info">Prudenziale</Badge>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                La modalità prudenziale pianifica il bilancio domestico considerando le entrate certe dei contributori e include spese fisse e accantonamenti progetti.
              </p>
            </div>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
};
