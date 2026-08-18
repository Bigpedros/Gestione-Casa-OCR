import React, { useState } from 'react';
import { FileText, AlertCircle } from 'lucide-react';
import { DashboardCard } from '../../../components/common';

/**
 * Predisposizione per estensioni future:
 * - documentVersion: string (es. '1.0.0-draft')
 * - documentHash: string (calcolo SHA-256)
 * - acceptedAt: string | null (timestamp ISO)
 * - licenseId: string | null
 * - deviceId: string | null
 * - appVersion: string
 */
export interface TermsAndConditionsCardProps {
  className?: string;
}

export const TermsAndConditionsCard: React.FC<TermsAndConditionsCardProps> = ({ className = '' }) => {
  const [isAccepted, setIsAccepted] = useState(false);

  return (
    <DashboardCard
      title="Condizioni generali e Licenza d'uso"
      badge={<FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
      subtitle="Termini e condizioni del contratto di licenza d'uso del software Gestione Casa OCR."
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
          aria-label="Area di testo Condizioni generali e Licenza d'uso"
          className="max-h-56 overflow-y-auto p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-sans leading-relaxed space-y-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
            exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure
            dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
            Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit
            anim id est laborum.
          </p>
          <p>
            Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et
            commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris.
            Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula.
            Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper, ligula eu tempor congue, eros
            est euismod turpis, id tincidunt sapien risus a quam. Maecenas fermentum consequat mi.
            Donec fermentum. Pellentesque malesuada nulla a mi. Duis sapien sem, aliquet nec, commodo
            eget, consequat quis, neque.
          </p>
          <p>
            Aliquam faucibus, elit ut dictum aliquet, felis nisl adipiscing sapien, sed malesuada diam
            lacus eget erat. Cras mollis scelerisque nunc. Nullam arcu. Aliquam consequat. Curabitur
            augue lorem, dapibus quis, laoreet et, pretium ac, nisi. Aenean magna nisl, mollis quis,
            molestie eu, feugiat in, orci. In hac habitasse platea dictumst.
          </p>
        </div>

        {/* Checkbox di predisposizione grafica */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="flex items-center gap-3 text-xs sm:text-sm font-semibold cursor-pointer text-slate-800 dark:text-slate-200 select-none">
            <input
              type="checkbox"
              checked={isAccepted}
              onChange={(e) => setIsAccepted(e.target.checked)}
              className="w-4 h-4 rounded-xs text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>Ho letto e accetto le Condizioni generali e la Licenza d'uso.</span>
          </label>
        </div>
      </div>
    </DashboardCard>
  );
};
