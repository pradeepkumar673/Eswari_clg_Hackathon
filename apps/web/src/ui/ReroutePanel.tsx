/**
 * apps/web/src/ui/ReroutePanel.tsx
 *
 * Supply Chain Manager decision panel for driver-selected routes and breakdown reroutes.
 * Approve or reject. Rejecting requires a reason. The driver is notified live.
 */

import { useCallback, useEffect, useState } from 'react';
import { Navigation, CheckCircle2, XCircle } from 'lucide-react';
import { getStoredToken, getStoredUser } from '../api/client.js';
import { googleMapsDirectionsUrl } from '../lib/navigation.js';

interface Warehouse {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

export function ReroutePanel() {
  const isManager = getStoredUser()?.role === 'Manager';
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredToken()}` };

  const load = useCallback(async () => {
    try {
      const [rr, wh] = await Promise.all([
        fetch('/api/v1/reroutes?status=PENDING', { headers }).then((r) => (r.ok ? r.json() : { proposals: [] })),
        fetch('/api/v1/warehouses', { headers }).then((r) => (r.ok ? r.json() : [])),
      ]);
      setItems(rr.proposals || []);
      const map: Record<string, Warehouse> = {};
      for (const w of wh as Warehouse[]) map[w.code] = w;
      setWarehouses(map);
    } catch {
      setMessage('Could not load pending route requests');
    }
    // headers are rebuilt from the stored token each call; the token does not change while mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isManager) return;
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [isManager, load]);

  if (!isManager) return null;

  const decide = async (proposalId: string, action: 'approve' | 'reject') => {
    const body = action === 'reject' ? { reason: (reasons[proposalId] || '').trim() } : {};
    if (action === 'reject' && !body.reason) {
      setMessage('Enter a reason before rejecting.');
      return;
    }
    try {
      const res = await fetch(`/api/v1/reroutes/${proposalId}/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok ? `Route ${action === 'approve' ? 'approved' : 'rejected'}.` : data.message || 'Action failed');
      load();
    } catch {
      setMessage('Network error');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Route decisions</h2>
      {message && <p className="text-xs text-indigo-700">{message}</p>}
      {items.length === 0 && <p className="text-sm text-slate-500">No driver route requests waiting.</p>}

      {items.map((p) => {
        const dest = warehouses[p.nearest_warehouse_id];
        const origin = p.from_position;
        const mapUrl =
          dest && origin
            ? googleMapsDirectionsUrl({ lat: dest.lat, lng: dest.lng }, { lat: origin.lat, lng: origin.lng })
            : null;

        return (
          <div key={p.proposal_id} className="border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-900">
                {p.truck_id} → {dest?.name ?? p.nearest_warehouse_id}
              </span>
              <span className="text-xs text-slate-500">≈ {p.road_km} km by road (estimate)</span>
            </div>
            <p className="text-xs text-slate-600">{p.reason}</p>
            {origin && (
              <p className="text-xs font-mono text-slate-500">
                Truck position: {origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Navigation className="w-3.5 h-3.5" /> View route on Google Maps
                </a>
              )}
              <button
                onClick={() => decide(p.proposal_id, 'approve')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={reasons[p.proposal_id] || ''}
                onChange={(e) => setReasons((r) => ({ ...r, [p.proposal_id]: e.target.value }))}
                placeholder="Reason (required to reject)"
                className="flex-1 min-w-[180px] px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
              />
              <button
                onClick={() => decide(p.proposal_id, 'reject')}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

