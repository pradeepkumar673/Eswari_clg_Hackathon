/**
 * apps/web/src/screens/SignInScreen.tsx
 *
 * Screen 1: Sign-in & Demo Role Switcher (Bright Executive Theme).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Button, Input } from '../ui/components.js';
import { ShieldCheck, ArrowRight, Zap } from 'lucide-react';

const DEMO_USERS = [
  { username: 'analyst1', role: 'Analyst', name: 'Priya Sharma (Analyst)', desc: 'Generates plans, edits candidates, drafts notices' },
  { username: 'manager1', role: 'Manager', name: 'Rajesh Kumar (Operations Manager)', desc: 'Approves reallocations, closes disruptions, executes plans' },
  { username: 'operator_blr', role: 'Warehouse_Operator', name: 'Karthik V (BLR Operator)', desc: 'Submits field reports for Bangalore Hub' },
  { username: 'procurement1', role: 'Procurement_Approver', name: 'Ananya Rao (Procurement Lead)', desc: 'Approves expedite spend and alternate suppliers' },
  { username: 'admin1', role: 'Administrator', name: 'System Admin (Security & Master Data)', desc: 'Manages master data, runs stress tests and red-team suites' },
];

export function SignInScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [username, setUsername] = useState('analyst1');
  const [password, setPassword] = useState('demo1234');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.auth.login(username, password);
      onLoginSuccess();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoSwitch = async (u: typeof DEMO_USERS[0]) => {
    setLoading(true);
    setError(null);
    try {
      await api.auth.demoSwitch(u.role, u.username);
      onLoginSuccess();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Demo switch failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 mb-4 shadow-xs">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">DisruptionIQ Control Tower</h2>
        <p className="mt-1 text-sm text-slate-500">Verified Recovery Desk for Supply Chain Operations</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 sm:rounded-xl sm:px-10">
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Username
              </label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              Sign In to Desk
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 uppercase tracking-wider mb-3">
              <Zap className="w-3.5 h-3.5 text-amber-600" /> Demo Quick-Switch Roles
            </div>
            <div className="space-y-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.username}
                  type="button"
                  onClick={() => handleDemoSwitch(u)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors flex items-center justify-between group shadow-xs"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800 group-hover:text-indigo-700">
                      {u.name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{u.desc}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 shrink-0 ml-2 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
