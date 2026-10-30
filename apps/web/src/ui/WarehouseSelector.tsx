/**
 * apps/web/src/ui/WarehouseSelector.tsx
 * Warehouse picker driven by the live list, with a green "+ New warehouse" button for managers.
 */

import type { WarehouseRecord } from '../hooks/useWarehouses.js';

interface Props {
  warehouses: WarehouseRecord[];
  value: string;
  onChange: (code: string) => void;
  onCreateNew: () => void;
  canCreate: boolean;
}

export function WarehouseSelector({ warehouses, value, onChange, onCreateNew, canCreate }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {warehouses.map((w) => (
        <button
          key={w.code}
          onClick={() => onChange(w.code)}
          title={w.name}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            value === w.code
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
          }`}
        >
          {w.code}
        </button>
      ))}
      {canCreate && (
        <button
          onClick={onCreateNew}
          className="px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          + New warehouse
        </button>
      )}
    </div>
  );
}

