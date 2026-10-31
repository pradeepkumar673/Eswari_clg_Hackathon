/**
 * apps/web/src/screens/RecoveryScreen.tsx
 *
 * Recovery Workbench on real plans only.
 *  - Target disruption from GET /disruptions
 *  - Latest plan from GET /disruptions/:id/recovery-plans/latest
 *  - Plan detail, action cards, claims, guardrails, promise dates from /plans/:id/*
 *  - Generate, verify, challenge (DEMO_MODE only), clear challenge, submit, promise-date edits
 *  - What-if sandbox from POST /whatif/run (simulation only, writes no plan)
 * Nothing is replaced with demo data. Failures are shown as errors.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, apiRequest } from '../api/client.js';

type Msg = { text: string; type: 'success' | 'error' } | null;
type Tab = 'plan' | 'whatif';

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const when = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';

/** ISO string to the "YYYY-MM-DDTHH:mm" value a datetime-local input needs (in local time). */
const toLocalInput = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  const local = new Date(x.getTime() - x.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const errText = (e: any) => e?.message || 'Request failed';

const FEAS_CLS: Record<string, string> = {
  FEASIBLE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  BLOCKED: 'bg-rose-100 text-rose-800 border-rose-300',
  PENDING_VERIFICATION: 'bg-amber-100 text-amber-800 border-amber-300',
};

const STATUS_CLS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  VERIFIED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  BLOCKED: 'bg-rose-100 text-rose-800 border-rose-300',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800 border-amber-300',
  SUBMITTED: 'bg-indigo-100 text-indigo-800 border-indigo-300',
};

function Badge({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      {text.replace(/_/g, ' ')}
    </span>
  );
}

export function RecoveryScreen() {
  const [tab, setTab] = useState<Tab>('plan');
  const [disruptions, setDisruptions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [plan, setPlan] = useState<any>(null);
  const [loadingPlan, setLoadingPlan] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // What-if form. Blank fields are not sent, so a blank never means "set to zero".
  const [wi, setWi] = useState({ delay_hours: '36', damaged_units: '50', lane_lead_hours: '12', supplier_capacity: '', stock_correction: '' });
  const [wiResult, setWiResult] = useState<any>(null);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadDisruptions = useCallback(async () => {
    const res: any = await api.investigation.getDisruptions();
    const rows: any[] = Array.isArray(res) ? res : res?.disruptions ?? [];
    setDisruptions(rows);
    setSelectedId((prev) => {
      if (prev && rows.some((r) => String(r._id ?? r.id) === prev)) return prev;
      return rows[0] ? String(rows[0]._id ?? rows[0].id) : '';
    });
  }, []);

  const loadPlan = useCallback(async (planId: string) => {
    const [full, cards, guard, promise] = await Promise.all([
      api.recovery.getPlan(planId),
      api.recovery.getCards(planId),
      api.recovery.getGuardrails(planId),
      api.recovery.getPromiseDates(planId),
    ]);
    setPlan({
      ...full.plan,
      per_order: full.per_order ?? [],
      collateral: full.collateral ?? [],
      claims: full.claims ?? [],
      cards: cards.cards ?? [],
      cost_total: cards.cost_total ?? 0,
      guardrails: guard.checks ?? [],
      promise_dates: promise.promise_dates ?? [],
    });
  }, []);

  const loadLatest = useCallback(
    async (disruptionId: string) => {
      if (!disruptionId) {
        setPlan(null);
        return;
      }
      setLoadingPlan(true);
      try {
        const r: any = await apiRequest(`/disruptions/${disruptionId}/recovery-plans/latest`);
        if (r.plan_id) await loadPlan(String(r.plan_id));
        else setPlan(null);
        setPageError(null);
      } catch (e) {
        setPlan(null);
        setPageError(errText(e));
      } finally {
        setLoadingPlan(false);
      }
    },
    [loadPlan],
  );

  useEffect(() => {
    loadDisruptions().catch((e) => setPageError(errText(e)));
  }, [loadDisruptions]);

  useEffect(() => {
    loadLatest(selectedId);
  }, [selectedId, loadLatest]);

  const reloadPlan = async () => {
    if (plan?._id) await loadPlan(String(plan._id));
  };

  // ── Actions. Each one reports the real result or the real error. ───────────
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: ok, type: 'success' });
    } catch (e) {
      setMsg({ text: errText(e), type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const r: any = await api.recovery.generatePlan(selectedId);
      await loadPlan(String(r.plan_id));
    }, 'New plan generated by the solver.');

  const verify = () =>
    run(async () => {
      await api.recovery.verifyPlan(plan._id);
      await reloadPlan();
    }, 'Verification finished.');

  const challenge = () =>
    run(async () => {
      await api.recovery.challengePlan(plan._id, 'Conservation of Mass Challenge', 40, 10);
      await reloadPlan();
    }, 'Challenge injected. The plan was re-verified against the ledger.');

  const clearChallenge = () =>
    run(async () => {
      await api.recovery.clearChallenge(plan._id);
      await reloadPlan();
    }, 'Challenge cleared.');

  const submit = () =>
    run(async () => {
      await api.recovery.submitPlan(plan._id);
      await reloadPlan();
    }, 'Plan submitted for approval.');

  const updateDate = (orderId: string, value: string) =>
    run(async () => {
      await api.recovery.updatePromiseDate(plan._id, orderId, new Date(value).toISOString());
      await reloadPlan();
    }, 'Committed promise date updated.');

  const runWhatIf = () =>
    run(async () => {
      const body: Record<string, unknown> = { disruption_id: selectedId };
      (Object.keys(wi) as Array<keyof typeof wi>).forEach((k) => {
        if (wi[k].trim() !== '') body[k] = Number(wi[k]);
      });
      setWiResult(await api.assistant.whatif(body));
    }, 'Simulation complete. Nothing was written to any plan.');

  // ── Derived ────────────────────────────────────────────────────────────────
  const cards: any[] = plan?.cards ?? [];
  const perOrder: any[] = plan?.per_order ?? [];
  const protectedCount = perOrder.filter((p) => (p.backordered_units ?? 0) === 0).length;
  const hasFailingCard = cards.some((c) => c.feasibility_status === 'BLOCKED');
  const claimsFailing = (plan?.claims ?? []).some((c: any) => c.status && c.status !== 'PASS');
  const submitted = plan?.status === 'SUBMITTED';

  return (
    <div className="p-6 space-y-6 text-slate-900 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Recovery Workbench</h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
              Solver and Decision Engine
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Constrained optimisation, trade-off ledger, verified claims, decision contract</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={disruptions.length === 0}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs min-w-[260px]"
          >
            {disruptions.length === 0 && <option value="">No disruptions yet</option>}
            {disruptions.map((d) => {
              const id = String(d._id ?? d.id);
              return (
                <option key={id} value={id}>
                  {d.disruption_type} · {d.shipment_id?.code ?? id.slice(-6)} · {d.status}
                </option>
              );
            })}
          </select>
          <button
            onClick={generate}
            disabled={busy || !selectedId}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Generate recovery plan'}
          </button>
        </div>
      </div>

      {pageError && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{pageError}</div>}
      {msg && (
        <div
          className={`p-3 rounded-lg border text-xs flex justify-between ${
            msg.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {(
          [
            ['plan', 'Recovery plan and contract'],
            ['whatif', 'What-if sandbox'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
              tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'plan' && (
        <>
          {loadingPlan && <p className="text-xs text-slate-500">Loading plan…</p>}

          {!loadingPlan && !plan && (
            <div className="p-8 rounded-xl bg-white border border-dashed border-slate-300 text-center text-sm text-slate-500">
              {selectedId
                ? 'No recovery plan exists for this disruption yet. Click "Generate recovery plan" to run the solver.'
                : 'Select a disruption. Disruptions appear after a shipment delay is applied.'}
            </div>
          )}

          {plan && (
            <>
              {/* Plan header and KPIs */}
              <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Plan v{plan.version}</span>
                  <Badge text={plan.status} cls={STATUS_CLS[plan.status] ?? STATUS_CLS.DRAFT} />
                  <span className="text-xs text-slate-500">{plan.scope}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Kpi label="Baseline cost (no action)" value={inr(plan.baseline_objective)} />
                  <Kpi label="Plan cost (with actions)" value={inr(plan.objective)} />
                  <Kpi label="Saving" value={inr(plan.saving)} tone="text-emerald-700" sub={`${plan.saving_pct}% of baseline`} />
                  <Kpi
                    label="Decision contract hash"
                    value={plan.contract_hash ? `${String(plan.contract_hash).slice(0, 12)}…` : 'Not sealed yet'}
                    mono
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <Kpi label="Orders fully protected" value={`${protectedCount} of ${perOrder.length}`} />
                  <Kpi label="Action cost total" value={inr(plan.cost_total)} />
                  <Kpi label="Created" value={when(plan.created_at)} small />
                  <Kpi label="Submitted" value={when(plan.submitted_at)} small />
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button onClick={verify} disabled={busy || submitted} className="px-3 py-1.5 border border-slate-300 rounded-md text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                    Verify claims
                  </button>
                  <button onClick={challenge} disabled={busy || submitted} className="px-3 py-1.5 border border-rose-300 text-rose-700 rounded-md text-xs font-semibold hover:bg-rose-50 disabled:opacity-50">
                    Challenge plan (demo fault)
                  </button>
                  <button onClick={clearChallenge} disabled={busy || submitted} className="px-3 py-1.5 border border-slate-300 rounded-md text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                    Clear challenge
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy || submitted || hasFailingCard || claimsFailing}
                    className="ml-auto px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50"
                  >
                    {submitted ? 'Submitted' : 'Submit for approval'}
                  </button>
                </div>
                {(hasFailingCard || claimsFailing) && !submitted && (
                  <p className="text-xs text-rose-700">Submit is blocked: a claim or action is failing verification.</p>
                )}
              </div>

              {/* Action cards */}
              <Section title={`Recovery actions (${cards.length})`}>
                {cards.length === 0 ? (
                  <p className="text-xs text-slate-500">This plan has no actions. The solver found nothing to do for it.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {cards.map((c) => (
                      <div key={c.card_id} className="p-4 rounded-lg border border-slate-200 bg-white space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[11px] font-mono text-slate-500">
                            #{c.seq} · {String(c.action_type).replace(/_/g, ' ')}
                          </span>
                          <Badge text={c.feasibility_status} cls={FEAS_CLS[c.feasibility_status] ?? FEAS_CLS.PENDING_VERIFICATION} />
                        </div>
                        <p className="text-xs text-slate-700">
                          {c.quantity} units · {c.duration_hours} h lead time
                        </p>
                        <ul className="space-y-1 text-xs">
                          {(c.feasibility_checklist ?? []).map((item: any, i: number) => (
                            <li key={i} className={item.passed ? 'text-emerald-700' : 'text-rose-700'}>
                              {item.passed ? '✓' : '✗'} {item.check}
                            </li>
                          ))}
                        </ul>
                        {c.failing_claim && (
                          <p className="text-xs text-rose-700">
                            Failing claim: expected {String(c.failing_claim.expected)}, actual {String(c.failing_claim.actual)}
                          </p>
                        )}
                        <div className="flex justify-between text-xs pt-2 border-t border-slate-100">
                          <span className="text-slate-500">Cost</span>
                          <span className="font-mono font-semibold">{inr(c.cost)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Trade-off ledger */}
              <Section title="Trade-off ledger">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                    <h3 className="text-xs font-bold text-emerald-800 mb-2">Protected by this plan</h3>
                    {perOrder.length === 0 ? (
                      <p className="text-xs text-slate-600">No order detail stored for this plan.</p>
                    ) : (
                      <ul className="text-xs space-y-1">
                        {perOrder.map((p: any) => (
                          <li key={p.code}>
                            {p.code}: {(p.backordered_units ?? 0) === 0 ? 'fully covered' : `${p.backordered_units} units still backordered`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="p-4 rounded-lg bg-rose-50 border border-rose-200">
                    <h3 className="text-xs font-bold text-rose-800 mb-2">Collateral cost</h3>
                    {(plan.collateral ?? []).length === 0 ? (
                      <p className="text-xs text-slate-600">No collateral effects recorded.</p>
                    ) : (
                      <ul className="text-xs space-y-1 list-disc pl-4">
                        {plan.collateral.map((t: string, i: number) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Section>

              {/* Claims */}
              <Section title="Verified claims" sub="Each premise checked against its source ledger">
                {(plan.claims ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">No claims recorded for this plan version.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="p-2">Claim</th>
                        <th className="p-2">Origin</th>
                        <th className="p-2">Expected</th>
                        <th className="p-2">Actual</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.claims.map((c: any) => (
                        <tr key={String(c._id)} className="border-t border-slate-100">
                          <td className="p-2">{String(c.claim_type).replace(/_/g, ' ')}</td>
                          <td className="p-2">{c.origin ?? '—'}</td>
                          <td className="p-2 font-mono">{String(c.expected ?? '—')}</td>
                          <td className="p-2 font-mono">{String(c.actual ?? '—')}</td>
                          <td className="p-2">
                            <Badge
                              text={c.status ?? 'UNKNOWN'}
                              cls={c.status === 'PASS' ? FEAS_CLS.FEASIBLE : FEAS_CLS.BLOCKED}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* Guardrails */}
              <Section title="Guardrail checks">
                {(plan.guardrails ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">No guardrail checks recorded for this plan version.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {plan.guardrails.map((g: any, i: number) => {
                      const status = g.status ?? (g.passed ? 'PASS' : 'BREACH');
                      return (
                        <div key={g._id ?? i} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold">{g.policy_id?.name ?? g.policy_id?.code ?? g.name ?? 'Guardrail'}</div>
                            <div className="text-slate-500">
                              Limit: {String(g.limit ?? g.threshold ?? '—')} · Actual: {String(g.actual ?? g.actual_value ?? '—')}
                            </div>
                          </div>
                          <Badge text={status} cls={status === 'PASS' ? FEAS_CLS.FEASIBLE : FEAS_CLS.BLOCKED} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>

              {/* Promise dates */}
              <Section title="Committed customer promise dates" sub="Dates can be extended, not moved back">
                {(plan.promise_dates ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">No orders are linked to this plan.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {plan.promise_dates.map((pd: any) => {
                      const orderId = String(pd.order_id);
                      const committed = pd.committed_date ?? pd.committed_promise_date;
                      return (
                        <div key={orderId} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                          <div>
                            <div className="font-semibold">{pd.order_code ?? pd.code ?? orderId}</div>
                            <div className="text-slate-500">Original due: {when(pd.original_due_date ?? pd.due_at)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600">Committed promise:</span>
                            <input
                              type="datetime-local"
                              defaultValue={toLocalInput(committed)}
                              disabled={busy || submitted}
                              onBlur={(e) => {
                                if (e.target.value && e.target.value !== toLocalInput(committed)) {
                                  updateDate(orderId, e.target.value);
                                }
                              }}
                              className="px-2 py-1 border border-slate-300 rounded-md font-mono"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            </>
          )}
        </>
      )}

      {tab === 'whatif' && (
        <Section title="What-if sandbox" sub="Simulates changes against current state. Creates no plan and changes no data.">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            {(
              [
                ['delay_hours', 'Extra delay (hours)'],
                ['damaged_units', 'Damaged units'],
                ['lane_lead_hours', 'Transfer lead time (h)'],
                ['supplier_capacity', 'Supplier capacity (blank = unchanged)'],
                ['stock_correction', 'Stock override (blank = unchanged)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1">
                <span className="text-slate-600">{label}</span>
                <input
                  type="number"
                  value={wi[key]}
                  onChange={(e) => setWi({ ...wi, [key]: e.target.value })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-md font-mono"
                />
              </label>
            ))}
          </div>
          <button
            onClick={runWhatIf}
            disabled={busy || !selectedId}
            className="mt-4 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50"
          >
            Run simulation
          </button>

          {wiResult && (
            <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <Kpi label="Baseline value" value={inr(wiResult.baseline_value)} />
              <Kpi label="Simulated plan value" value={inr(wiResult.plan_value)} />
              <Kpi label="Simulated saving" value={inr(wiResult.saving)} tone="text-emerald-700" sub={`${wiResult.saving_pct ?? 0}%`} />
              <Kpi label="Affected orders" value={String((wiResult.affected_orders ?? []).length)} />
              <div className="md:col-span-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">Approvals needed: </span>
                <span className="font-semibold">{(wiResult.approvals_needed ?? []).join(', ') || 'none'}</span>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</h2>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'text-slate-900', mono = false, small = false }: { label: string; value: string; sub?: string; tone?: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className={`${small ? 'text-xs' : 'text-lg'} font-bold mt-0.5 ${mono ? 'font-mono' : ''} ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
