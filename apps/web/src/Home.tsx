import React, { useEffect, useState } from 'react';
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
      <header className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">DisruptionIQ Control Tower</h1>
        <p className="text-sm text-slate-400">Verified Recovery Desk System Health</p>
      </header>

      {loading && (
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
          Checking backend health...
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-lg bg-red-950/50 border border-red-800 text-red-200">
          Failed to fetch health check: {errorMsg}
        </div>
      )}

      {health && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-semibold text-slate-400 mb-2">API Service Status</h2>
            <div className="text-lg font-mono text-emerald-400">{health.status.toUpperCase()}</div>
            <div className="text-xs text-slate-500 mt-1">Uptime: {Math.floor(health.uptime)}s</div>
          </div>

          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-semibold text-slate-400 mb-2">Database Status</h2>
            <div className="text-sm space-y-1">
              <div>Connected: <span className={health.mongo.connected ? 'text-emerald-400' : 'text-red-400'}>{String(health.mongo.connected)}</span></div>
              <div>Transactions: <span className={health.mongo.transactionsSupported ? 'text-emerald-400' : 'text-amber-400'}>{String(health.mongo.transactionsSupported)}</span></div>
              <div>Replica Set: <span className="font-mono text-slate-300">{health.mongo.replicaSet || 'none'}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

