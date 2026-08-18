import React, { useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { DashboardCard } from '../../../components/common';

/**
 * Predisposizione per estensioni future:
 * - documentVersion: string (es. '1.0.0-draft')
 * - documentHash: string (calcolo SHA-256)
 * - acknowledgedAt: string | null (timestamp ISO)
 * - licenseId: string | null
 * - deviceId: string | null
 * - appVersion: string
 */
export interface PrivacyPolicyCardProps {
  className?: string;
}

export const PrivacyPolicyCard: React.FC<PrivacyPolicyCardProps> = ({ className = '' }) => {
  const [isAcknowledged, setIsAcknowledged] = useState(false);

  return (
    <DashboardCard
      title="Informativa Privacy"
      badge={<ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
      subtitle="Trattamento dei dati personali, archiviazione locale e informativa sulla privacy."
      className={className}
    >
      <div className="space-y-4 pt-2">
        {/* Avviso BOZZA */}
        <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 font-medium">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>BOZZA — Testo definitivo in fase di definizione</strong>
          </span>
        </div>

        {/* Area di testo scorrevole con testo segnaposto Lorem ipsum */}
        <div
          tabIndex={0}
          role="region"
          aria-label="Area di testo Informativa Privacy"
          className="max-h-56 overflow-y-auto p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-sans leading-relaxed space-y-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent
            libero. Sed cursus ante dapibus diam. Sed nisi. Nulla quis sem at nibh elementum
            imperdiet. Duis sagittis ipsum. Praesent mauris. Fusce nec tellus sed augue semper porta.
            Mauris massa. Vestibulum lacinia arcu eget nulla. Class aptent taciti sociosqu ad litora
            torquent per conubia nostra, per inceptos himenaeos.
          </p>
          <p>
            Curabitur sodales ligula in libero. Sed dignissim lacinia nunc. Curabitur tortor.
            Pellentesque nibh. Aenean quam. In scelerisque sem at dolor. Maecenas mattis. Sed convallis
            tristique sem. Proin ut ligula vel nunc egestas porttitor. Morbi lectus risus, iaculis vel,
            suscipit quis, luctus non, massa. Fusce ac turpis quis ligula lacinia aliquet. Mauris
            ipsum.
          </p>
          <p>
            Nulla metus metus, ullamcorper vel, tincidunt sed, euismod in, nibh. Quisque volutpat
            condimentum velit. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per
            inceptos himenaeos. Nam nec ante. Sed lacinia, urna non tincidunt mattis, tortor neque
            adipiscing diam, a cursus ipsum ante quis turpis. Nulla facilisi. Ut fringilla. Suspendisse
            potenti. Nunc feugiat mi a tellus consequat imperdiet.
          </p>
        </div>

        {/* Checkbox di predisposizione grafica */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="flex items-center gap-3 text-xs sm:text-sm font-semibold cursor-pointer text-slate-800 dark:text-slate-200 select-none">
            <input
              type="checkbox"
              checked={isAcknowledged}
              onChange={(e) => setIsAcknowledged(e.target.checked)}
              className="w-4 h-4 rounded-xs text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>Dichiaro di aver preso visione dell'Informativa Privacy.</span>
          </label>
        </div>
      </div>
    </DashboardCard>
  );
};
