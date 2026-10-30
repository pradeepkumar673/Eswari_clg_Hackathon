/**
 * apps/web/src/screens/ApprovalsScreen.tsx
 *
 * Screen 7: Approvals and execution (Step 13 shell, full body in Step 15).
 * Title: Approvals and Execution
 * Purpose: Govern
 */

import { EmptyState } from '../ui/components.js';

export function ApprovalsScreen() {
  return (
    <div className="p-6 space-y-6 text-slate-100 max-w-7xl mx-auto">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white">7. Approvals and Execution</h1>
        <p className="text-xs text-slate-400">Govern — Queue, required-role chips, Approve, Reject, Modify, reservation conflict card, Confirm and Execute, Rollback</p>
      </div>

      <div className="p-8 rounded-lg bg-slate-900 border border-slate-800 text-center">
        <EmptyState
          title="Role-Governed Approval Queue & Execution Engine Ready"
          description="Pending approvals, separation-of-duties enforcement, and execution ledger triggers will render here in Step 15 on real API data."
        />
      </div>
    </div>
  );
}
