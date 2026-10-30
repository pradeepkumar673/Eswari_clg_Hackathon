/**
 * apps/web/src/screens/AuditScreen.tsx
 *
 * Screen 8: Audit and security (Step 13 shell, full body in Step 15).
 * Title: Audit and Security
 * Purpose: Prove
 */

import { EmptyState } from '../ui/components.js';

export function AuditScreen() {
  return (
    <div className="p-6 space-y-6 text-slate-100 max-w-7xl mx-auto">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white">8. Audit and Security</h1>
        <p className="text-xs text-slate-400">Prove — Filterable audit table, ledger before/after, red-team result grid, notifications, and SHA-256 chain verification</p>
      </div>

      <div className="p-8 rounded-lg bg-slate-900 border border-slate-800 text-center">
        <EmptyState
          title="Cryptographic Hash Chain & Provenance Audit Ready"
          description="Tamper-evident verification, ledger inspection, and red-team bypass report will render here in Step 15 on real API data."
        />
      </div>
    </div>
  );
}
