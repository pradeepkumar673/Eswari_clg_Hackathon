/**
 * apps/web/src/screens/ApprovalsScreen.tsx
 *
 * Approvals and execution on real plans only.
 *  - Queue from GET /approvals/queue (unwrapped from { queue })
 *  - Plan review and sign-offs from GET /approvals/plans/:id/review
 *  - Approve, reject, request changes, execute, rollback on /plans/:id/*
 *  - Delegations and customer notices from their real endpoints
 * Nothing is faked. If the backend refuses an action, its message is shown.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, apiRequest, getStoredUser } from '../api/client.js';

type Tab = 'queue' | 'delegations' | 'notices';
type Msg = { text: string; type: 'success' | 'error' } | null;

const APPROVER_ROLES = ['Manager', 'Procurement_Approver'];

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

/** Date to the "YYYY-MM-DDTHH:mm" value a datetime-local input needs, in local time. */
const toLocalInput = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const errText = (e: any) => e?.message || 'Request failed';

const post = (path: string, body: unknown) =>
  apiRequest<any>(path, { method: 'POST', body: JSON.stringify(body) });

const STATUS_CLS: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800 border-amber-300',
  SUBMITTED: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  EXECUTED: 'bg-sky-100 text-sky-800 border-sky-300',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-300',
  BLOCKED: 'bg-rose-100 text-rose-800 border-rose-300',
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
};

function Badge({ text, cls }: { text: string; cls?: string }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls ?? 'bg-slate-100 text-slate-700 border-slate-300'}`}
    >
      {String(text).replace(/_/g, ' ')}
    </span>
  );
}

export function ApprovalsScreen() {
  const me = getStoredUser();
  const canApprove = !!me && APPROVER_ROLES.includes(me.role);
  const isManager = me?.role === 'Manager';

  const [tab, setTab] = useState<Tab>('queue');
  const [queue, setQueue] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [detail, setDetail] = useState<any>(null);
  const [delegations, setDelegations] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<Msg>(null);

  const [note, setNote] = useState<string>('');
  const [ackBreach, setAckBreach] = useState<boolean>(false);
  const [execResult, setExecResult] = useState<any>(null);

  const [newDel, setNewDel] = useState({
    delegate_id: '',
    role: 'Procurement_Approver',
    reason: '',
    valid_until: toLocalInput(new Date(Date.now() + 2 * 86400000)),
  });

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    const res: any = await api.approvals.getQueue();
    const rows: any[] = Array.isArray(res) ? res : res?.queue ?? [];
    setQueue(rows);
    setSelectedPlanId((prev) => {
      if (prev && rows.some((r) => String(r.plan_id) === prev)) return prev;
      return rows[0] ? String(rows[0].plan_id) : '';
    });
  }, []);

  const loadDetail = useCallback(async (planId: string) => {
    if (!planId) {
      setDetail(null);
      return;
    }
    const r: any = await apiRequest(`/approvals/plans/${planId}/review`);
    setDetail(r);
  }, []);

  const loadSide = useCallback(async () => {
    const results = await Promise.allSettled([
      api.approvals.getDelegations(),
      apiRequest<any[]>('/approvals/delegate-candidates'),
      api.approvals.getNotices(),
    ]);
    const [d, c, n] = results;
    setDelegations(d.status === 'fulfilled' && Array.isArray(d.value) ? d.value : []);
    setCandidates(c.status === 'fulfilled' && Array.isArray(c.value) ? c.value : []);
    setNotices(n.status === 'fulfilled' && Array.isArray(n.value) ? n.value : []);
    const errs = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => errText(r.reason));
    setSideError(errs.length ? errs.join(' · ') : null);
  }, []);

  useEffect(() => {
    loadQueue().catch((e) => setPageError(errText(e)));
    const t = setInterval(() => loadQueue().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [loadQueue]);

  useEffect(() => {
    loadDetail(selectedPlanId)
      .then(() => setPageError(null))
      .catch((e) => {
        setDetail(null);
        setPageError(errText(e));
      });
    setExecResult(null);
    setAckBreach(false);
  }, [selectedPlanId, loadDetail]);

  useEffect(() => {
    loadSide();
  }, [loadSide]);

  // ── Actions ────────────────────────────────────────────────────────────────
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

  const refreshPlan = async () => {
    await loadQueue();
    if (selectedPlanId) await loadDetail(selectedPlanId);
    setNote('');
  };

  const approve = () =>
    run(async () => {
      await post(`/plans/${selectedPlanId}/approve`, { comment: note.trim() || undefined });
      await refreshPlan();
    }, 'Sign-off recorded.');

  const reject = () => {
    if (!note.trim()) {
      setMsg({ text: 'Enter a reason in the notes box before rejecting.', type: 'error' });
      return;
    }
    run(async () => {
      await post(`/plans/${selectedPlanId}/reject`, { reason: note.trim() });
      await refreshPlan();
    }, 'Plan rejected.');
  };

  const requestChanges = () => {
    if (!note.trim()) {
      setMsg({ text: 'Enter what needs to change in the notes box.', type: 'error' });
      return;
    }
    run(async () => {
      await post(`/plans/${selectedPlanId}/request-changes`, { comment: note.trim() });
      await refreshPlan();
    }, 'Changes requested. The plan returns to the planner.');
  };

  const execute = () =>
    run(async () => {
      const res = await post(`/plans/${selectedPlanId}/execute`, {
        confirmed: true,
        guardrail_acknowledgement: ackBreach,
      });
      setExecResult(res);
      await refreshPlan();
    }, 'Plan executed.');

  const rollback = () =>
    run(async () => {
      await post(`/plans/${selectedPlanId}/rollback`, {
        reason: note.trim() || 'Rollback requested from Approvals screen',
      });
      await refreshPlan();
    }, 'Plan rolled back.');

  const createDelegation = () =>
    run(async () => {
      if (!newDel.delegate_id) throw new Error('Choose who to delegate to.');
      await post('/approvals/delegations', {
        delegate_id: newDel.delegate_id,
        role: newDel.role,
        reason: newDel.reason,
        valid_until: new Date(newDel.valid_until).toISOString(),
      });
      await loadSide();
    }, 'Delegation created.');

  const revokeDelegation = (id: string) =>
    run(async () => {
      await api.approvals.revokeDelegation(id);
      await loadSide();
    }, 'Delegation revoked.');

  const releaseNotice = (id: string) =>
    run(async () => {
      await api.approvals.releaseNotice(id);
      await loadSide();
    }, 'Notice released to the outbox.');

  // ── Derived ────────────────────────────────────────────────────────────────
  const plan = detail?.plan;
  const signoffs: any[] = detail?.signoffs ?? [];
  const actions: any[] = detail?.actions ?? [];
  const isCreator = !!plan && !!me && (plan.created_by === me.id || plan.submitted_by === me.id);
  const myApprovalPending = signoffs.some((s) => s.status === 'PENDING' && s.required_role === me?.role);
  const canSignHere = canApprove && myApprovalPending && !isCreator && plan?.status === 'PENDING_APPROVAL';
  const canExecuteHere = isManager && plan?.status === 'APPROVED' && !isCreator;
  const canRollbackHere = isManager && plan?.status === 'EXECUTED';

  return (
    <div className="p-6 space-y-6 text-slate-900 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Approvals and Execution</h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              Role-governed ledger
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Separation of duties, sign-off by role, staged execution, and reversible rollback
          </p>
        </div>
        <button
          onClick={() => {
            loadQueue().catch((e) => setPageError(errText(e)));
            loadSide();
          }}
          className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-semibold hover:bg-slate-50"
        >
          Refresh
        </button>
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
            ['queue', `Approvals queue (${queue.length})`],
            ['delegations', `Authority delegations (${delegations.length})`],
            ['notices', `Customer notices (${notices.length})`],
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

      {/* ── Queue ── */}
      {tab === 'queue' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Pending for your role</h2>
            {queue.length === 0 && (
              <div className="p-4 rounded-lg bg-white border border-dashed border-slate-300 text-xs text-slate-500">
                Nothing waiting for your sign-off. Plans appear here after a planner submits them.
              </div>
            )}
            {queue.map((q) => {
              const id = String(q.plan_id);
              return (
                <button
                  key={String(q.approval_id)}
                  onClick={() => setSelectedPlanId(id)}
                  className={`w-full text-left p-4 rounded-lg border transition ${
                    selectedPlanId === id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">Plan {id.slice(-8)}</span>
                    <Badge text={q.required_role} />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Version {q.plan_version} · {q.strategy ?? 'strategy n/a'}
                  </div>
                  <div className="flex justify-between text-xs mt-2">
                    <span className="text-slate-500">Net saving</span>
                    <span className="font-mono font-semibold text-emerald-700">{inr(q.saving)}</span>
                  </div>
                  {q.delegation_chip && (
                    <div className="text-[11px] text-indigo-700 mt-1">
                      Delegated from {q.delegation_chip.delegated_from}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-2 space-y-6">
            {!plan ? (
              <div className="p-8 rounded-xl bg-white border border-dashed border-slate-300 text-center text-sm text-slate-500">
                Select a plan to review it.
              </div>
            ) : (
              <>
                {/* Plan header and actions */}
                <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold font-mono">Plan {String(plan._id).slice(-8)}</h2>
                        <Badge text={plan.status} cls={STATUS_CLS[plan.status]} />
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{plan.scope}</p>
                      <p className="text-xs text-slate-500 font-mono">Version {plan.version} · Contract {plan.contract_hash ? `${String(plan.contract_hash).slice(0, 12)}…` : 'not sealed'}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <Mini label="Baseline" value={inr(plan.baseline)} />
                      <Mini label="Plan cost" value={inr(plan.objective)} />
                      <Mini label="Saving" value={`${inr(plan.saving)} (${plan.saving_pct}%)`} tone="text-emerald-700" />
                    </div>
                  </div>

                  {plan.escalation_required && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      This plan is escalated. A guardrail breach must be acknowledged before execution.
                    </div>
                  )}
                  {isCreator && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      You created or submitted this plan, so you cannot approve or execute it (separation of duties).
                    </div>
                  )}
                </div>

                {/* Sign-offs */}
                <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Required sign-offs</h3>
                  {signoffs.length === 0 ? (
                    <p className="text-xs text-slate-500">No sign-off rows exist for this plan version yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {signoffs.map((s) => (
                        <div key={String(s._id)} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold">{String(s.required_role).replace(/_/g, ' ')}</div>
                            <div className="text-slate-500">
                              {s.decided_by ? `${s.decided_by.display_name} · ${when(s.decided_at)}` : 'Awaiting decision'}
                            </div>
                            {s.comment && <div className="text-slate-600 italic mt-0.5">"{s.comment}"</div>}
                          </div>
                          <Badge text={s.status} cls={STATUS_CLS[s.status] ?? STATUS_CLS.DRAFT} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Decision controls */}
                <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Decision</h3>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Notes: required for reject and request changes, optional for approval"
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={approve} disabled={busy || !canSignHere} className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-40">
                      Sign and approve
                    </button>
                    <button onClick={requestChanges} disabled={busy || !canSignHere} className="px-3 py-1.5 border border-slate-300 rounded-md text-xs font-semibold disabled:opacity-40">
                      Request changes
                    </button>
                    <button onClick={reject} disabled={busy || !canSignHere} className="px-3 py-1.5 bg-rose-600 text-white rounded-md text-xs font-semibold disabled:opacity-40">
                      Reject
                    </button>
                  </div>
                  {!canSignHere && (
                    <p className="text-xs text-slate-500">
                      {!canApprove
                        ? `Your role (${me?.role}) cannot sign plans.`
                        : isCreator
                        ? 'You cannot sign a plan you created.'
                        : !myApprovalPending
                        ? 'No sign-off is pending for your role on this plan.'
                        : `Plan is ${plan.status}, so it is not open for sign-off.`}
                    </p>
                  )}
                </div>

                {/* Actions to execute */}
                <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Actions in this plan</h3>
                  {actions.length === 0 ? (
                    <p className="text-xs text-slate-500">No actions recorded.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {actions.map((a) => (
                        <div key={String(a._id)} className="p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                          <div className="font-mono text-[11px] text-slate-500">#{a.seq}</div>
                          <div className="font-semibold">{String(a.action_type).replace(/_/g, ' ')}</div>
                          <div className="text-slate-600">{a.quantity} units · {a.duration_hours} h</div>
                          <div className="flex justify-between pt-1">
                            <span className="text-slate-500">Cost</span>
                            <span className="font-mono">{inr(a.cost)}</span>
                          </div>
                          <div className="text-slate-500">Status: {a.status}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {canExecuteHere && (
                    <div className="pt-3 border-t border-slate-100 space-y-3">
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" checked={ackBreach} onChange={(e) => setAckBreach(e.target.checked)} />
                        I acknowledge any guardrail breach on this plan (needed only when escalated)
                      </label>
                      <button onClick={execute} disabled={busy} className="px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-semibold disabled:opacity-40">
                        Execute approved plan
                      </button>
                    </div>
                  )}
                  {execResult && (
                    <pre className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] overflow-x-auto">
                      {JSON.stringify(execResult, null, 2)}
                    </pre>
                  )}
                  {canRollbackHere && (
                    <button onClick={rollback} disabled={busy} className="px-3 py-1.5 border border-rose-300 text-rose-700 rounded-md text-xs font-semibold disabled:opacity-40">
                      Roll back execution (uses the notes box as the reason)
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Delegations ── */}
      {tab === 'delegations' && (
        <div className="space-y-6">
          {sideError && <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{sideError}</div>}

          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Active delegations</h2>
            {delegations.length === 0 ? (
              <p className="text-xs text-slate-500">No active delegations involving you.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {delegations.map((d) => (
                  <div key={String(d._id)} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold">
                        {d.delegator_id?.display_name ?? 'Delegator'} → {d.delegate_id?.display_name ?? 'Delegate'}
                      </div>
                      <div className="text-slate-500">
                        Role: {String(d.role).replace(/_/g, ' ')} · Until {when(d.valid_until)}
                      </div>
                      {d.reason && <div className="text-slate-500 italic">{d.reason}</div>}
                    </div>
                    {isManager && (
                      <button onClick={() => revokeDelegation(String(d._id))} disabled={busy} className="px-2.5 py-1 border border-rose-300 text-rose-700 rounded-md font-semibold disabled:opacity-40">
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isManager && (
            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Delegate approval authority</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-600">Delegate to</span>
                  <select
                    value={newDel.delegate_id}
                    onChange={(e) => setNewDel({ ...newDel, delegate_id: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md"
                  >
                    <option value="">Choose a user</option>
                    {candidates.map((c) => (
                      <option key={String(c._id)} value={String(c._id)}>
                        {c.display_name} ({String(c.role).replace(/_/g, ' ')})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Role being delegated</span>
                  <select
                    value={newDel.role}
                    onChange={(e) => setNewDel({ ...newDel, role: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md"
                  >
                    <option value="Procurement_Approver">Procurement Approver</option>
                    <option value="Manager">Manager</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Valid until</span>
                  <input
                    type="datetime-local"
                    value={newDel.valid_until}
                    onChange={(e) => setNewDel({ ...newDel, valid_until: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Reason</span>
                  <input
                    type="text"
                    value={newDel.reason}
                    onChange={(e) => setNewDel({ ...newDel, reason: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md"
                  />
                </label>
              </div>
              <button onClick={createDelegation} disabled={busy} className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-40">
                Create delegation
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Notices ── */}
      {tab === 'notices' && (
        <div className="space-y-4">
          {sideError && <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{sideError}</div>}
          {notices.length === 0 && (
            <div className="p-8 rounded-xl bg-white border border-dashed border-slate-300 text-center text-sm text-slate-500">
              No customer notices yet. Notices are drafted from a recovery plan that changes delivery promises.
            </div>
          )}
          {notices.map((n) => {
            const released = n.status === 'RELEASED' || n.status === 'SENT';
            return (
              <div key={String(n._id)} className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{n.subject ?? 'Customer notice'}</div>
                    <div className="text-xs text-slate-500">
                      {n.customer_name ?? n.customer ?? '—'} · {n.order_code ?? n.order_id ?? '—'} · {n.channel ?? 'channel n/a'}
                    </div>
                  </div>
                  <Badge text={n.status ?? 'DRAFT'} />
                </div>
                {n.body && <p className="text-xs text-slate-700 whitespace-pre-line">{n.body}</p>}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    {n.new_promise_date ? `New promise: ${when(n.new_promise_date)}` : ''}
                  </span>
                  {isManager && !released && (
                    <button onClick={() => releaseNotice(String(n._id))} disabled={busy} className="px-3 py-1.5 bg-indigo-600 text-white rounded-md font-semibold disabled:opacity-40">
                      Release to outbox
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone = 'text-slate-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 min-w-[110px]">
      <div className="text-slate-500">{label}</div>
      <div className={`font-mono font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
