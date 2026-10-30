import { useEffect, useState } from 'react';
import { HealthResponse } from '@disruptioniq/shared';

export function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => {
        if (!res.ok && res.status !== 503) {
          throw new Error(`HTTP status: ${res.status}`);
        }
        return res.json();
      })
      .then((data: HealthResponse) => {
        setHealth(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setErrorMsg(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">DisruptionIQ Control Tower</h1>
        <p className="text-sm text-slate-600">Verified Recovery Desk System Health</p>
      </header>

      {loading && (
        <div className="p-4 rounded-lg bg-white border border-slate-200 text-slate-600 shadow-xs">
          Checking backend health...
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          Failed to fetch health check: {errorMsg}
        </div>
      )}

      {health && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">API Service Status</h2>
            <div className="text-lg font-mono font-bold text-emerald-700">{health.status.toUpperCase()}</div>
            <div className="text-xs text-slate-500 mt-1">Uptime: {Math.floor(health.uptime)}s</div>
          </div>

          <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Database Status</h2>
            <div className="text-sm space-y-1 text-slate-700">
              <div>Connected: <span className={health.mongo.connected ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>{String(health.mongo.connected)}</span></div>
              <div>Transactions: <span className={health.mongo.transactionsSupported ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>{String(health.mongo.transactionsSupported)}</span></div>
              <div>Replica Set: <span className="font-mono text-slate-800 font-medium">{health.mongo.replicaSet || 'none'}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

