/**
 * apps/web/src/ui/NewWarehouseDialog.tsx
 *
 * Create a warehouse. Paste "lat, lng" straight from Google Maps and both fields fill in.
 * Draw the site footprint afterwards in the Mapper; that sets the exact location.
 */

import { useState } from 'react';
import { api } from '../api/client.js';

interface Props {
  onClose: () => void;
  onCreated: (code: string) => void;
}

const PAIR = /(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/;

export function NewWarehouseDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [paste, setPaste] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [hours, setHours] = useState('2');
  const [isHub, setIsHub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestCode = (n: string) => 'WH-' + n.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

  const onName = (v: string) => {
    setName(v);
    if (!codeEdited) setCode(suggestCode(v));
  };

  const onPaste = (text: string) => {
    setPaste(text);
    const m = text.match(PAIR);
    if (m) {
      setLat(m[1]);
      setLng(m[2]);
    }
  };

  const submit = async () => {
    setError(null);
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      lat: Number(lat),
      lng: Number(lng),
      processing_hours: Number(hours),
      is_hub: isHub,
    };
    if (!/^WH-[A-Z0-9]{2,10}$/.test(body.code)) {
      setError('Code must look like WH-KRS (2 to 10 letters or digits after WH-).');
      return;
    }
    if (body.name.length < 2) {
      setError('Enter a warehouse name.');
      return;
    }
    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng) || lat === '' || lng === '') {
      setError('Paste coordinates from Google Maps, or enter latitude and longitude.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.warehouses.create(body);
      onCreated(res.code ?? body.code);
    } catch (e: any) {
      setError(e.message || 'Could not create the warehouse');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm';

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">New warehouse</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 font-bold">
            ✕
          </button>
        </div>

        <label className="block text-xs font-semibold text-slate-600 space-y-1">
          <span>Name</span>
          <input className={field} value={name} onChange={(e) => onName(e.target.value)} placeholder="Krishnagiri Hub" />
        </label>

        <label className="block text-xs font-semibold text-slate-600 space-y-1">
          <span>Code</span>
          <input
            className={field}
            value={code}
            onChange={(e) => {
              setCodeEdited(true);
              setCode(e.target.value.toUpperCase());
            }}
            placeholder="WH-KRS"
          />
        </label>

        <label className="block text-xs font-semibold text-slate-600 space-y-1">
          <span>Paste coordinates from Google Maps</span>
          <input className={field} value={paste} onChange={(e) => onPaste(e.target.value)} placeholder="12.5186, 78.2137" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Latitude</span>
            <input className={field} value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Longitude</span>
            <input className={field} value={lng} onChange={(e) => setLng(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Processing hours</span>
            <input type="number" min={0} max={72} className={field} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-2">
            <input type="checkbox" checked={isHub} onChange={(e) => setIsHub(e.target.checked)} />
            Regional hub
          </label>
        </div>

        {error && <p className="text-xs text-rose-700 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold"
          >
            {busy ? 'Creating…' : 'Create warehouse'}
          </button>
        </div>
      </div>
    </div>
  );
}

