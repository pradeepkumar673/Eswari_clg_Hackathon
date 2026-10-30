/**
 * apps/web/src/screens/ImpactScreen.tsx
 *
 * Screen 5: Impact and risk (Step 13 shell, full body in Step 14).
 * Title: Impact and Risk
 * Purpose: Which orders and why
 */

import { EmptyState } from '../ui/components.js';

export function ImpactScreen() {
  return (
    <div className="p-6 space-y-6 text-slate-100 max-w-7xl mx-auto">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white">5. Impact and Risk</h1>
        <p className="text-xs text-slate-400">Which orders and why — Ranked orders, factor waterfall, score range, and evidence drawer</p>
      </div>

      <div className="p-8 rounded-lg bg-slate-900 border border-slate-800 text-center">
        <EmptyState
          title="Impact & Risk Analysis Engine Ready"
          description="Live order ranking, causal factor waterfall, and lineage graph will render here in Step 14 on real API data."
        />
      </div>
    </div>
  );
}
