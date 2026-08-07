import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { contributorRepository, settingsRepository } from '../../repositories';
import {
  PageHeader,
  DashboardCard,
  Button,
} from '../../components/common';
import { Settings, CheckCircle2, Plus, Trash2, AlertCircle, Mail, Home, Headphones } from 'lucide-react';
import type { AppSettings, Contributor, HomeAddress } from '../../types';

export const SettingsPage: React.FC = () => {
  const dbContributors = useLiveQuery(() => contributorRepository.getAll(), []);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [editedContributors, setEditedContributors] = useState<Contributor[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Home Address state
  const [homeAddress, setHomeAddress] = useState<HomeAddress>({
    address: '',
    streetNumber: '',
    postalCode: '',
  });
  const [homeAddressError, setHomeAddressError] = useState<string | null>(null);
  const [homeAddressSavedMsg, setHomeAddressSavedMsg] = useState(false);

  useEffect(() => {
    settingsRepository.get().then((s) => {
      setSettings(s);
      if (s.homeAddress) {
        setHomeAddress({
          address: s.homeAddress.address || '',
          streetNumber: s.homeAddress.streetNumber || '',
          postalCode: s.homeAddress.postalCode || '',
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (dbContributors && !isInitialized) {
      setEditedContributors(dbContributors);
      setIsInitialized(true);
    }
  }, [dbContributors, isInitialized]);

  const handleSaveHomeAddress = async () => {
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

      const updated = await settingsRepository.update({
        homeAddress: updatedAddress,
      });

      setSettings(updated);
      setHomeAddress(updatedAddress);
      setHomeAddressSavedMsg(true);
      setTimeout(() => setHomeAddressSavedMsg(false), 3000);
    } catch {
      setHomeAddressError('Impossibile salvare i dati dell’abitazione. Riprova.');
    }
  };

  const handleUpdateField = (id: string, field: keyof Contributor, value: any) => {
    setEditedContributors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  };

  const handleAddContributor = () => {
    if (editedContributors.length >= 3) {
      setErrorMsg('Massimo tre contribuenti consentiti');
      return;
    }
    const order = editedContributors.length + 1;
    const now = new Date().toISOString();
    const newContrib: Contributor = {
      id: `contrib-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      order,
      name: '',
      label: 'Stipendio',
      active: true,
      email: '',
      receiveDeadlineEmails: false,
      receive48HourReminder: false,
      receive24HourReminder: false,
      emailDeliveryStatus: 'provider_not_configured',
      colorToken: order === 1 ? '#4F46E5' : order === 2 ? '#0EA5E9' : '#10B981',
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    setEditedContributors((prev) => [...prev, newContrib]);
    setErrorMsg(null);
  };

  const handleRemoveContributor = (id: string) => {
    setEditedContributors((prev) =>
      prev
        .filter((c) => c.id !== id)
        .map((c, idx) => ({ ...c, order: idx + 1 })),
    );
    setErrorMsg(null);
  };

  const handleSaveContributors = async () => {
    if (editedContributors.length > 3) {
      setErrorMsg('Massimo tre contribuenti consentiti');
      return;
    }

    const contributorNamePattern = /^[\p{L}]+(?:\s+[\p{L}]+)*$/u;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const c of editedContributors) {
      const rawName = c.name || '';
      const trimmedName = rawName.trim().replace(/\s+/g, ' ');

      if (!trimmedName) {
        setErrorMsg('Indica il nome del contributore.');
        return;
      }

      if (!contributorNamePattern.test(trimmedName)) {
        setErrorMsg('Il nome può contenere soltanto lettere e spazi.');
        return;
      }

      const trimmedEmail = (c.email || '').trim();
      if (trimmedEmail.length > 0 && !emailRegex.test(trimmedEmail)) {
        setErrorMsg(`Indirizzo e-mail non valido per ${trimmedName}`);
        return;
      }
    }

    const normalized = editedContributors.map((c) => ({
      ...c,
      name: (c.name || '').trim().replace(/\s+/g, ' '),
      email: c.email ? c.email.trim() : '',
    }));

    try {
      await contributorRepository.saveAll(normalized);
      setEditedContributors(normalized);
      setSavedMsg(true);
      setErrorMsg(null);
      setTimeout(() => setSavedMsg(false), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante il salvataggio');
    }
  };

  const handleSaveSettings = async (theme: AppSettings['theme']) => {
    if (!settings) return;
    const updated = await settingsRepository.update({ theme });
    setSettings(updated);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  if (!settings) return <div className="p-12 text-center text-slate-500 font-medium">Caricamento impostazioni...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<Settings className="w-6 h-6 text-indigo-600" />}
        title="Impostazioni Applicazione"
        subtitle="Configura la modalità casa, i contributori e le preferenze di sistema."
        actions={
          savedMsg ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2 rounded-2xl">
              <CheckCircle2 className="w-4 h-4" /> Modifiche salvate con successo
            </span>
          ) : undefined
        }
      />

      {/* Abitazione Settings */}
      <DashboardCard
        title="Abitazione"
        badge={<Home className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
        subtitle="Inserisci i dati dell’abitazione gestita dall’applicazione."
        action={
          homeAddressSavedMsg ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3.5 py-1.5 rounded-xl">
              <CheckCircle2 className="w-4 h-4" /> Dati dell’abitazione salvati.
            </span>
          ) : undefined
        }
      >
        <div className="space-y-4 pt-2">
          {homeAddressError && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 rounded-2xl text-xs font-medium border border-rose-200 dark:border-rose-900">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{homeAddressError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-sm">
            <div>
              <label htmlFor="home-address-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Indirizzo
              </label>
              <input
                id="home-address-input"
                type="text"
                autoComplete="street-address"
                placeholder="Esempio: Via Roma"
                value={homeAddress.address}
                onChange={(e) =>
                  setHomeAddress((prev) => ({ ...prev, address: e.target.value }))
                }
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="home-street-number-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Numero civico
              </label>
              <input
                id="home-street-number-input"
                type="text"
                placeholder="Esempio: 25/A"
                value={homeAddress.streetNumber}
                onChange={(e) =>
                  setHomeAddress((prev) => ({ ...prev, streetNumber: e.target.value }))
                }
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="home-postal-code-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                CAP
              </label>
              <input
                id="home-postal-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                placeholder="Esempio: 00100"
                value={homeAddress.postalCode}
                onChange={(e) =>
                  setHomeAddress((prev) => ({ ...prev, postalCode: e.target.value }))
                }
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="button"
              variant="primary"
              icon={<CheckCircle2 className="w-4 h-4" />}
              onClick={handleSaveHomeAddress}
            >
              Salva abitazione
            </Button>
          </div>
        </div>
      </DashboardCard>

      {/* Contributor Settings */}
      <DashboardCard
        title="Contributori Nucleo Familiare (Max 3)"
        subtitle="Definisci i nomi, la tipologia di contributo e le preferenze e-mail per i promemoria"
        action={
          editedContributors.length < 3 ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={handleAddContributor}
            >
              Aggiungi Contributore
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4 pt-2">
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 rounded-2xl text-xs font-medium border border-rose-200 dark:border-rose-900">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-4 text-sm">
            {editedContributors.map((c, index) => (
              <div key={c.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 space-y-3.5 border border-slate-200/60 dark:border-slate-700/50">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white">Contributore {index + 1}</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={c.active}
                        onChange={(e) => handleUpdateField(c.id, 'active', e.target.checked)}
                        className="rounded-xs text-indigo-600 focus:ring-indigo-500"
                      />
                      Attivo
                    </label>
                    {editedContributors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveContributor(c.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700 cursor-pointer"
                        title="Rimuovi contributore"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor={`contrib-name-${c.id}`} className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Nome Contributore</label>
                    <input
                      id={`contrib-name-${c.id}`}
                      type="text"
                      autoComplete="name"
                      placeholder="Inserisci il nome"
                      value={c.name}
                      onChange={(e) => handleUpdateField(c.id, 'name', e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor={`contrib-type-${c.id}`} className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Tipologia Contributo</label>
                    <select
                      id={`contrib-type-${c.id}`}
                      value={c.label && ['Stipendio', 'Pensione', 'Rendita', 'Rimborso', 'Altro'].includes(c.label) ? c.label : 'Stipendio'}
                      onChange={(e) => handleUpdateField(c.id, 'label', e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm cursor-pointer"
                    >
                      <option value="Stipendio">Stipendio</option>
                      <option value="Pensione">Pensione</option>
                      <option value="Rendita">Rendita</option>
                      <option value="Rimborso">Rimborso</option>
                      <option value="Altro">Altro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Indirizzo e-mail</label>
                    <input
                      type="email"
                      placeholder="nome@esempio.com"
                      value={c.email || ''}
                      onChange={(e) => handleUpdateField(c.id, 'email', e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                </div>

                {/* Email & Reminders preferences */}
                <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/50">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Preferenze Notifiche ed E-mail
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <label className="flex items-center gap-2 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(c.receiveDeadlineEmails)}
                        onChange={(e) => handleUpdateField(c.id, 'receiveDeadlineEmails', e.target.checked)}
                        className="rounded-xs text-indigo-600 focus:ring-indigo-500"
                      />
                      Ricevi notifiche sulle scadenze
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(c.receive48HourReminder)}
                        onChange={(e) => handleUpdateField(c.id, 'receive48HourReminder', e.target.checked)}
                        className="rounded-xs text-indigo-600 focus:ring-indigo-500"
                      />
                      Ricevi promemoria 48 ore prima
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(c.receive24HourReminder)}
                        onChange={(e) => handleUpdateField(c.id, 'receive24HourReminder', e.target.checked)}
                        className="rounded-xs text-indigo-600 focus:ring-indigo-500"
                      />
                      Ricevi promemoria 24 ore prima
                    </label>
                  </div>
                </div>

                {/* Email Service Status Indicator */}
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300">
                  <Mail className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1">
                    <span className="font-semibold">Stato del servizio e-mail: </span>
                    <span className="text-amber-700 dark:text-amber-400">Servizio e-mail non configurato (in attesa di provider backend)</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="button"
              variant="primary"
              icon={<CheckCircle2 className="w-4 h-4" />}
              onClick={handleSaveContributors}
            >
              Salva Contributori
            </Button>
          </div>
        </div>
      </DashboardCard>

      {/* Supporto e Contatti */}
      <DashboardCard
        title="Supporto e Contatti"
        badge={<Headphones className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
        subtitle="Invia una richiesta di supporto o contatto al team di Gestione Casa OCR."
      >
        <div className="pt-2 flex items-center justify-between">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Hai bisogno di assistenza o vuoi inviare una richiesta di informazioni o licenza?
          </p>
          <Link to="/settings/contact">
            <Button variant="primary" size="sm" icon={<Headphones className="w-4 h-4" />}>
              Supporto e Contatti
            </Button>
          </Link>
        </div>
      </DashboardCard>

      {/* General Settings */}
      <DashboardCard
        title="Preferenze Generali"
        subtitle="Lingua, valuta e impostazioni del tema visuale"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm pt-2">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Lingua</label>
            <input
              type="text"
              value={settings.language}
              disabled
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Valuta</label>
            <input
              type="text"
              value={settings.currency}
              disabled
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tema Visuale</label>
            <select
              value={settings.theme}
              onChange={(e) => handleSaveSettings(e.target.value as AppSettings['theme'])}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="system">Sistema</option>
              <option value="light">Chiaro</option>
              <option value="dark">Scuro</option>
            </select>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
};
