import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { contributorRepository, settingsRepository } from '../../repositories';
import {
  isUnusedPlaceholderContributor,
  filterVisibleContributors,
} from '../../utils/contributorUtils';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
} from '../../components/common';
import {
  Settings,
  CheckCircle2,
  Plus,
  Trash2,
  AlertCircle,
  Mail,
  Home,
  Headphones,
  Key,
  ShieldCheck,
} from 'lucide-react';
import type { AppSettings, Contributor, HomeAddress } from '../../types';
import { useLicense } from '../../hooks/useLicense';
import { ROUTES } from '../../app/routes';

export const SettingsPage: React.FC = () => {
  const dbContributors = useLiveQuery(() => contributorRepository.getAll(), []);
  const dbIncomeEntries = useLiveQuery(() => db.incomeEntries.toArray(), []);

  const referencedContributorIds = useMemo(() => {
    const set = new Set<string>();
    if (dbIncomeEntries) {
      for (const inc of dbIncomeEntries) {
        if (inc.contributorId) {
          set.add(inc.contributorId);
        }
      }
    }
    return set;
  }, [dbIncomeEntries]);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [editedContributors, setEditedContributors] = useState<Contributor[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // License state from LicenseContext
  const {
    localState,
    maskedLicenseCode,
    status: licenseStatus,
    validationStatus,
    isValid: isLicenseValid,
    edition: licenseEdition,
    owner: licenseOwner,
    deactivationStatus,
    isLoading: isLicenseLoading,
  } = useLicense();

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
      if (dbContributors.length === 0) {
        // Nuova configurazione: mostra inizialmente 1 solo contributore
        const now = new Date().toISOString();
        setEditedContributors([
          {
            id: 'contrib-1',
            order: 1,
            name: '',
            label: 'Stipendio',
            active: true,
            email: '',
            receiveDeadlineEmails: false,
            receive48HourReminder: false,
            receive24HourReminder: false,
            emailDeliveryStatus: 'provider_not_configured',
            colorToken: '#4F46E5',
            metadata: { createdAt: now, updatedAt: now, version: 1 },
          },
        ]);
      } else {
        // Filtra i placeholder tecnici non utilizzati preservando tutti i contributori reali/attivi/referenziati
        const visible = filterVisibleContributors(dbContributors, referencedContributorIds);
        setEditedContributors(visible);
      }
      setIsInitialized(true);
    }
  }, [dbContributors, isInitialized, referencedContributorIds]);

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
    const currentCount = editedContributors.length;
    const nextOrder = currentCount + 1;
    const now = new Date().toISOString();

    // Cerca se nel DB esiste un placeholder inattivo/non utilizzato per questo slot o un ID corrispondente
    const existingPlaceholder = (dbContributors || []).find(
      (c) =>
        !editedContributors.some((ec) => ec.id === c.id) &&
        (c.order === nextOrder || c.id === `contrib-${nextOrder}` || isUnusedPlaceholderContributor(c, referencedContributorIds))
    );

    let newContrib: Contributor;
    if (existingPlaceholder) {
      // Riutilizza il record placeholder esistente senza creare duplicazioni
      const rawName = (existingPlaceholder.name || '').trim();
      const isPlaceholderName =
        !rawName ||
        /^contributore(\s*\d*)?$/i.test(rawName) ||
        /^(secondo|terzo)\s+contributore$/i.test(rawName);
      const rawEmail = (existingPlaceholder.email || '').trim().toLowerCase();
      const isPlaceholderEmail =
        !rawEmail ||
        rawEmail === 'nome@esempio.com' ||
        rawEmail.includes('esempio');

      newContrib = {
        ...existingPlaceholder,
        order: nextOrder,
        name: isPlaceholderName ? '' : existingPlaceholder.name,
        email: isPlaceholderEmail ? '' : existingPlaceholder.email,
        active: true,
        label: existingPlaceholder.label || 'Stipendio',
        colorToken: nextOrder === 1 ? '#4F46E5' : nextOrder === 2 ? '#0EA5E9' : '#10B981',
      };
    } else {
      // Crea nuovo contributore
      newContrib = {
        id: `contrib-${nextOrder}`,
        order: nextOrder,
        name: '',
        label: 'Stipendio',
        active: true,
        email: '',
        receiveDeadlineEmails: false,
        receive48HourReminder: false,
        receive24HourReminder: false,
        emailDeliveryStatus: 'provider_not_configured',
        colorToken: nextOrder === 1 ? '#4F46E5' : nextOrder === 2 ? '#0EA5E9' : '#10B981',
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
    }

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

  // Badge di stato calcolato per la card di riepilogo licenza
  const renderLicenseStatusBadge = () => {
    if (isLicenseLoading) {
      return <Badge variant="neutral">Caricamento...</Badge>;
    }
    if (deactivationStatus === 'DEACTIVATION_PENDING_CONFIRMATION') {
      return <Badge variant="warning">Disattivazione in sospeso</Badge>;
    }
    if (licenseStatus === 'deactivated' || deactivationStatus === 'DEACTIVATED') {
      return <Badge variant="neutral">Disattivata</Badge>;
    }
    if (licenseStatus === 'LICENSE_REVOKED' || validationStatus === 'LICENSE_REVOKED') {
      return <Badge variant="danger">Revocata</Badge>;
    }
    if (licenseStatus === 'LICENSE_SUSPENDED' || validationStatus === 'LICENSE_SUSPENDED') {
      return <Badge variant="danger">Sospesa</Badge>;
    }
    if (licenseStatus === 'LICENSE_EXPIRED' || validationStatus === 'LICENSE_EXPIRED') {
      return <Badge variant="danger">Scaduta</Badge>;
    }
    if (licenseStatus === 'DEVICE_MISMATCH' || validationStatus === 'DEVICE_MISMATCH') {
      return <Badge variant="danger">Dispositivo non corrispondente</Badge>;
    }
    if (isLicenseValid) {
      return <Badge variant="success">Attiva e Valida</Badge>;
    }
    return <Badge variant="neutral">Non attivata</Badge>;
  };

  if (!settings) return <div className="p-12 text-center text-slate-500 font-medium">Caricamento impostazioni...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<Settings className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
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

      {/* 1. Attivazione licenza (Nuovo primo riquadro) */}
      <DashboardCard
        title="Attivazione licenza"
        badge={
          <div className="flex items-center gap-2">
            {renderLicenseStatusBadge()}
          </div>
        }
        subtitle="Gestione stato licenza, attivazione e verifica dispositivo per Gestione Casa OCR."
      >
        <div className="space-y-4 pt-2">
          {isLicenseValid && localState?.licenseCode ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/60">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    Licenza {licenseEdition ? `Edizione ${licenseEdition}` : 'Attiva'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Codice: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{maskedLicenseCode}</span>
                  {licenseOwner && <span> • Intestatario: <strong>{licenseOwner}</strong></span>}
                </p>
              </div>

              <Link to={ROUTES.LICENSE}>
                <Button variant="primary" size="sm" icon={<Key className="w-4 h-4" />}>
                  Gestisci licenza
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {licenseStatus === 'deactivated' ? 'Licenza disattivata' : 'Nessuna licenza attiva'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Accedi alla pagina dedicata per inserire un nuovo codice di attivazione o verificare la licenza.
                </p>
              </div>

              <Link to={ROUTES.LICENSE}>
                <Button variant="primary" size="sm" icon={<Key className="w-4 h-4" />}>
                  Gestisci licenza
                </Button>
              </Link>
            </div>
          )}
        </div>
      </DashboardCard>

      {/* 2. Abitazione */}
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

      {/* 3. Contributori nucleo familiare — massimo 3 */}
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
              + Aggiungi contributore
            </Button>
          ) : (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
              Limite massimo raggiunto (3 contributori)
            </span>
          )
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

      {/* 4. Supporto e Contatti */}
      <DashboardCard
        title="Supporto e Contatti"
        badge={<Headphones className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
        subtitle="Invia una richiesta di supporto o contatto al team di Gestione Casa OCR."
      >
        <div className="pt-2 flex items-center justify-between">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Hai bisogno di assistenza o vuoi inviare una richiesta di informazioni o licenza?
          </p>
          <Link to={ROUTES.CONTACT}>
            <Button variant="primary" size="sm" icon={<Headphones className="w-4 h-4" />}>
              Supporto e Contatti
            </Button>
          </Link>
        </div>
      </DashboardCard>

      {/* 5. Preferenze Generali */}
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
