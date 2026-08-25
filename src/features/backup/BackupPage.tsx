import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { backupService } from '../../services/backupService';
import {
  PageHeader,
  DashboardCard,
  Button,
} from '../../components/common';
import {
  HardDrive,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import type { BackupData } from '../../types';
import { ROUTES } from '../../app/routes';

export const BackupPage: React.FC = () => {
  const [importedData, setImportedData] = useState<BackupData | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleExport = async () => {
    try {
      const jsonStr = await backupService.exportBackup();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GestioneCasa_Backup_${new Date().toISOString().substring(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ type: 'success', text: 'Backup JSON esportato con successo (manifest e checksum inclusi)!' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Errore durante l'esportazione: ${(err as Error).message}` });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      const res = backupService.validateBackup(content);
      if (res.isValid && res.data) {
        setImportedData(res.data);
        setStatusMsg({ type: 'success', text: 'File di backup verificato con successo. Esamina il manifest prima di confermare.' });
      } else {
        setImportedData(null);
        setStatusMsg({ type: 'error', text: res.error || 'File di backup non valido.' });
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!importedData) return;
    setIsProcessing(true);
    try {
      // 1. Esegui automaticamente backup preventivo di sicurezza prima di sovrascrivere
      const currentJson = await backupService.exportBackup();
      const safetyBlob = new Blob([currentJson], { type: 'application/json' });
      const safetyUrl = URL.createObjectURL(safetyBlob);
      const a = document.createElement('a');
      a.href = safetyUrl;
      a.download = `GestioneCasa_SafetyBackup_Preventivo_${new Date().toISOString().substring(0, 19).replace(/:/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(safetyUrl);

      // 2. Ripristina il database con i nuovi dati
      await backupService.importBackup(importedData);
      setImportedData(null);
      setStatusMsg({
        type: 'success',
        text: 'Database ripristinato con successo! È stato scaricato anche un backup di sicurezza preventivo per tutelare i tuoi dati precedenti.',
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Errore durante il ripristino: ${(err as Error).message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <PageHeader
        icon={<HardDrive className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Backup e Ripristino Dati"
        subtitle="Esporta i tuoi dati in formato JSON con checksum di integrità o ripristina un backup precedente con salvataggio preventivo."
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

      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Link
          to={ROUTES.SETTINGS}
          className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Impostazioni
        </Link>
        <span>/</span>
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Backup</span>
      </div>

      {statusMsg && (
        <div
          className={`p-4 rounded-2xl border flex items-center gap-3 text-sm font-semibold animate-in fade-in ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export Box */}
        <DashboardCard>
          <div className="space-y-4 flex flex-col h-full justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 shrink-0">
                  <Download className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">Esporta Backup JSON</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Scarica una copia completa con manifest e checksum di integrità.</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Include tutte le tabelle locali: entrate, uscite, scontrini, categorie, fornitori, allegati e licenza.
              </p>
            </div>

            <Button
              variant="primary"
              fullWidth
              icon={<Download className="w-4 h-4" />}
              onClick={handleExport}
            >
              Scarica Backup Sicuro
            </Button>
          </div>
        </DashboardCard>

        {/* Import Box */}
        <DashboardCard>
          <div className="space-y-4 flex flex-col h-full justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">Ripristina da Backup</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Seleziona un file JSON di Gestione Casa per ripristinare i dati.</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Il sistema eseguirà automaticamente un backup preventivo di sicurezza prima di effettuare qualsiasi modifica.
              </p>
            </div>

            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-200 cursor-pointer"
            />
          </div>
        </DashboardCard>
      </div>

      {/* Preview and Confirmation Box (013-I Manifest Check) */}
      {importedData && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-6 rounded-3xl space-y-4 shadow-xs animate-in fade-in">
          <div className="flex items-start gap-3 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-base">Manifest e Verifica Integrità Backup</h4>
              <p className="text-xs mt-1 leading-relaxed">
                Verifica i metadati del file prima del ripristino. Verrà generato un backup preventivo salvato nei tuoi download.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-200/60 dark:border-amber-800/60 text-xs space-y-2 font-medium">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <span className="text-slate-400 text-[11px] block">Applicazione</span>
                <span className="font-bold text-slate-900 dark:text-white">{importedData.appName}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Schema Versione</span>
                <span className="font-bold text-slate-900 dark:text-white">{importedData.schemaVersion || '2.0.0'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Data Esportazione</span>
                <span className="font-bold text-slate-900 dark:text-white">{importedData.exportedAt ? new Date(importedData.exportedAt).toLocaleDateString() : 'N/D'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Checksum SHA</span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">{importedData.checksum ? `${importedData.checksum.substring(0, 10)}...` : 'OK'}</span>
              </div>
            </div>

            <p className="text-indigo-600 dark:text-indigo-400 font-bold pt-1">
              Entrate: {importedData.tables?.incomeEntries?.length || 0} • Uscite: {importedData.tables?.expenses?.length || 0} • Progetti: {importedData.tables?.projects?.length || 0} • Fornitori: {importedData.tables?.suppliers?.length || 0} • Allegati: {importedData.tables?.attachments?.length || 0}
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setImportedData(null)}
              disabled={isProcessing}
            >
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmImport}
              disabled={isProcessing}
            >
              {isProcessing ? 'Ripristino in corso...' : 'Conferma e Ripristina Dati'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

