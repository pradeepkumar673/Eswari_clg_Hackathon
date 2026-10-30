/**
 * apps/web/src/screens/RecoveryScreen.tsx
 *
 * Screen 6: Recovery workbench (Step 13 shell, full body in Step 14).
 * Title: Recovery Workbench
 * Purpose: Decide
 */

import { EmptyState } from '../ui/components.js';

export function RecoveryScreen() {
  return (
    <div className="p-6 space-y-6 text-slate-100 max-w-7xl mx-auto">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white">6. Recovery Workbench</h1>
        <p className="text-xs text-slate-400">Decide — Baseline vs plan, per-order outcome bars, collateral panel, claims list with expected vs actual, Challenge Plan, Decision Contract, and Submit</p>
      </div>

      <div className="p-8 rounded-lg bg-slate-900 border border-slate-800 text-center">
        <EmptyState
          title="Recovery Plan Generation & Verification Workbench Ready"
          description="Solver tradeoffs, route diagrams, and Decision Contract proof checker will render here in Step 14 on real API data."
        />
      </div>
    </div>
  );
}
