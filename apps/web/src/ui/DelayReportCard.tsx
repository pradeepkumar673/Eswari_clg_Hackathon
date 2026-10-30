/**
 * apps/web/src/ui/DelayReportCard.tsx
 *
 * Driver states how late the truck is against the promised arrival.
 * Submitted to /driver/delay-report, which runs the reconciler and pushes the result live.
 */

import { useState } from 'react';
import { getStoredToken } from '../api/client.js';

const HOUR_OPTIONS = [0.5, 1, 2, 3, 4, 6, 8];
const REASONS = ['Traffic jam', 'Road closure', 'Weather', 'Vehicle problem', 'Other'];

export function DelayReportCard({ truckId }: { truckId: string }) {
  const [hours, setHours] = useState<number>(2);
  const [reason, setReason] = useState<string>('Traffic jam');
  const [location, setLocation] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/driver/delay-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getStoredToken()}`,
        },
        body: JSON.stringify({
          delay_hours: hours,
          reason,
          location: location.trim() || null,
          idempotency_key: `${truckId}-${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Report failed');
      setResult(`${data.status}: ${data.reason}`);
    } catch (e: any) {
      setResult(e.message || 'Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Report delay</h2>
      <p className="text-xs text-slate-600">How late are you now compared with the promised arrival time?</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-slate-600 space-y-1">
          <span>Hours late</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold text-slate-600 space-y-1">
          <span>Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold text-slate-600 space-y-1">
          <span>Where (optional)</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Bangalore toll gate"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </label>
      </div>

      <button
        onClick={submit}
        disabled={busy}
        className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold"
      >
        {busy ? 'Sending…' : 'Report delay'}
      </button>

      {result && <p className="text-xs text-slate-700 font-medium">{result}</p>}
    </div>
  );
}

