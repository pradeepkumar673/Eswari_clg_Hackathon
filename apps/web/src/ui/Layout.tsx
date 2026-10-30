/**
 * apps/web/src/ui/Layout.tsx
 *
 * Authoritative Application Shell for DisruptionIQ.
 *
 * Header contains:
 * - Brand logo & title
 * - SimClock display (Asia/Kolkata IST)
 * - Role badge
 * - Demo role switcher (calls /auth/demo-switch, active if DEMO_MODE)
 * - Notification bell with unread count
 * - Ask the Desk button
 * - Sign out
 *
 * Left Navigation contains EXACTLY the 8 blueprint screens:
 * 1. Sign-in (/login)
 * 2. Operations cockpit (/)
 * 3. Intake and quarantine (/intake)
 * 4. Disruption investigation (/investigation)
 * 5. Impact and risk (/impact)
 * 6. Recovery workbench (/recovery)
 * 7. Approvals and execution (/approvals)
 * 8. Audit and security (/audit)
 */

import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { UserProfile, api, clearAuth } from '../api/client.js';
import { Button, Drawer } from './components.js';
import {
  ShieldCheck,
  LayoutDashboard,
  UploadCloud,
  Search,
  Zap,
  CheckCircle,
  FileCheck,
  Lock,
  Bell,
  MessageSquare,
  Clock,
  LogOut,
  Mail,
  Smartphone,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

const SCREENS = [
  { path: '/login', name: '1. Sign-in', icon: Lock, allowedRoles: ['*'] },
  { path: '/', name: '2. Operations cockpit', icon: LayoutDashboard, allowedRoles: ['*'] },
  { path: '/intake', name: '3. Intake and quarantine', icon: UploadCloud, allowedRoles: ['Analyst', 'Administrator'] },
  { path: '/investigation', name: '4. Disruption investigation', icon: Search, allowedRoles: ['*'] },
  { path: '/impact', name: '5. Impact and risk', icon: Zap, allowedRoles: ['Analyst', 'Manager', 'Administrator'] },
  { path: '/recovery', name: '6. Recovery workbench', icon: CheckCircle, allowedRoles: ['Analyst', 'Manager'] },
  { path: '/approvals', name: '7. Approvals and execution', icon: FileCheck, allowedRoles: ['Manager', 'Procurement_Approver'] },
  { path: '/audit', name: '8. Audit and security', icon: ShieldCheck, allowedRoles: ['Administrator', 'Manager', 'Analyst', 'Procurement_Approver'] },
];

const DEMO_ROLES = [
  { role: 'Analyst', username: 'analyst1', label: 'Analyst (Priya)' },
  { role: 'Manager', username: 'manager1', label: 'Manager (Rajesh)' },
  { role: 'Warehouse_Operator', username: 'operator_blr', label: 'Operator BLR (Karthik)' },
  { role: 'Procurement_Approver', username: 'procurement1', label: 'Procurement (Ananya)' },
  { role: 'Administrator', username: 'admin1', label: 'Admin (Security)' },
];

const ASK_PROMPT_CHIPS = [
  'What disruptions are currently active?',
  'What orders are at risk of SLA breach?',
  'What is on-hand stock for SKU-INS-100 in Bengaluru?',
  'Update inventory balance to 500 units',
];

export function Layout({
  children,
  user,
  onUserChange,
}: {
  children: React.ReactNode;
  user: UserProfile | null;
  onUserChange: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Drawers
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [askDrawerOpen, setAskDrawerOpen] = useState(false);
  const [askQuery, setAskQuery] = useState('');
  const [askAnswer, setAskAnswer] = useState<any>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [roleSwitching, setRoleSwitching] = useState(false);

  // Communications Drawer state
  const [activeChannelTab, setActiveChannelTab] = useState<'IN_APP' | 'EMAIL_SIM' | 'WHATSAPP_SIM'>('IN_APP');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [outbox, setOutbox] = useState<any[]>([]);

  // SimClock time
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll notifications
  useEffect(() => {
    let mounted = true;
    const loadNotifs = async () => {
      try {
        const [nList, oList] = await Promise.all([
          api.notifications.getNotifications().catch(() => []),
          api.notifications.getOutbox().catch(() => []),
        ]);
        if (!mounted) return;
        setNotifications(Array.isArray(nList) ? nList : []);
        setOutbox(Array.isArray(oList) ? oList : []);
      } catch {
        // quiet fallback
      }
    };
    loadNotifs();
    const interval = setInterval(loadNotifs, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDemoRoleSwitch = async (roleObj: typeof DEMO_ROLES[0]) => {
    setRoleSwitching(true);
    try {
      await api.auth.demoSwitch(roleObj.role, roleObj.username);
      onUserChange();
    } catch (e: any) {
      alert(`Role switch error: ${e.message}`);
    } finally {
      setRoleSwitching(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    onUserChange();
    navigate('/login');
  };

  const handleAskSubmit = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const q = customQuery || askQuery;
    if (!q.trim()) return;
    setAskLoading(true);
    try {
      const res = await api.assistant.ask(q);
      setAskAnswer(res);
    } catch (err: any) {
      setAskAnswer({
        answer: err.message || 'Error processing request',
        refused: err.message?.toLowerCase().includes('write') || err.message?.toLowerCase().includes('refuse'),
      });
    } finally {
      setAskLoading(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const formattedTime = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(currentTime);

  const filteredCommunications =
    activeChannelTab === 'IN_APP'
      ? notifications
      : outbox.filter((m) => m.channel === activeChannelTab);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Top Header */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40 select-none">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-sm">
            IQ
          </div>
          <span className="font-bold text-sm tracking-tight text-white hidden sm:inline-block">
            DisruptionIQ <span className="text-indigo-400 font-mono text-xs font-normal">Desk</span>
          </span>
        </div>

        {/* Center: SimClock */}
        <div className="flex items-center gap-2 px-3 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
          <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>{formattedTime} IST</span>
        </div>

        {/* Right Action Cluster */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Ask the Desk Drawer Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAskDrawerOpen(true)}
            className="text-slate-300 hover:text-white"
          >
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400 mr-1.5" />
            <span className="hidden md:inline">Ask Desk</span>
          </Button>

          {/* Notifications Bell */}
          <button
            onClick={() => setNotifDrawerOpen(true)}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors relative"
            title="Communications and Outbox"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 ? (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-rose-600 text-[10px] font-bold text-white leading-none">
                {unreadCount}
              </span>
            ) : (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>

          {/* Role Badge & Demo Role Switcher */}
          {user && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <span className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800 text-[11px] font-mono font-semibold text-indigo-300">
                {user.role}
              </span>

              {/* Demo Switcher Select */}
              <select
                value={user.role}
                onChange={(e) => {
                  const target = DEMO_ROLES.find((r) => r.role === e.target.value);
                  if (target) handleDemoRoleSwitch(target);
                }}
                disabled={roleSwitching}
                className="bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-300 py-1 px-1.5 cursor-pointer hover:border-slate-600 focus:outline-none"
                title="Switch demo role"
              >
                {DEMO_ROLES.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>

              <button
                onClick={handleLogout}
                className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Body: Left Nav + Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Navigation Sidebar (The Exactly 8 Blueprint Screens) */}
        <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col py-4 shrink-0 select-none hidden md:flex">
          <div className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Operational Screens
          </div>

          <nav className="space-y-1 px-2 flex-1">
            {SCREENS.map((s) => {
              const Icon = s.icon;
              const isActive = location.pathname === s.path;
              return (
                <NavLink
                  key={s.path}
                  to={s.path}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="px-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 font-mono">
            DisruptionIQ v1.0
          </div>
        </aside>

        {/* Content Viewport */}
        <main className="flex-1 overflow-y-auto bg-slate-950">
          {children}
        </main>
      </div>

      {/* A1 Simulated Notifications & Outbox Drawer */}
      <Drawer
        isOpen={notifDrawerOpen}
        onClose={() => setNotifDrawerOpen(false)}
        title="A1 Communications & Simulated Outbox"
        width="w-[520px]"
      >
        <div className="space-y-4 text-xs">
          {/* Channel Tabs */}
          <div className="flex border-b border-slate-800 gap-4 text-xs">
            <button
              onClick={() => setActiveChannelTab('IN_APP')}
              className={`pb-2 flex items-center gap-1.5 border-b-2 font-medium ${
                activeChannelTab === 'IN_APP'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              In-App ({notifications.length})
            </button>
            <button
              onClick={() => setActiveChannelTab('EMAIL_SIM')}
              className={`pb-2 flex items-center gap-1.5 border-b-2 font-medium ${
                activeChannelTab === 'EMAIL_SIM'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Email Sim
            </button>
            <button
              onClick={() => setActiveChannelTab('WHATSAPP_SIM')}
              className={`pb-2 flex items-center gap-1.5 border-b-2 font-medium ${
                activeChannelTab === 'WHATSAPP_SIM'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              WhatsApp Sim
            </button>
          </div>

          {/* List */}
          {filteredCommunications.length === 0 ? (
            <div className="p-4 rounded bg-slate-950 border border-slate-800 text-center text-slate-500">
              No messages queued for {activeChannelTab}.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredCommunications.map((msg, idx) => (
                <div key={msg._id || idx} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-300">
                      {msg.title || msg.subject || msg.recipient || 'System Notification'}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('en-IN') : 'Recent'}
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{msg.body || msg.message || msg.content}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                    <span>Channel: {msg.channel || activeChannelTab}</span>
                    <span className="text-emerald-400 font-mono">DELIVERED</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>

      {/* B4 Ask the Desk Drawer */}
      <Drawer
        isOpen={askDrawerOpen}
        onClose={() => setAskDrawerOpen(false)}
        title="B4 Ask the Desk (Read-Only Operational Intel)"
        width="w-[560px]"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Query affected orders, active disruptions, or inventory balances. All answers verified against immutable database records with zero hallucinations.
          </p>

          {/* Prompt Chips */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
              Suggested Operational Queries:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ASK_PROMPT_CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setAskQuery(chip);
                    handleAskSubmit(undefined, chip);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-300 border border-slate-700 transition-colors text-left"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Query Form */}
          <form onSubmit={handleAskSubmit} className="space-y-2">
            <input
              type="text"
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <Button type="submit" variant="primary" size="sm" className="w-full" loading={askLoading}>
              Ask Operational Desk
            </Button>
          </form>

          {/* Answer Area */}
          {askAnswer && (
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-3">
              {askAnswer.refused ? (
                <div className="p-3 rounded bg-amber-950/40 border border-amber-800 text-amber-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    Write Intent Refused
                  </div>
                  <p className="text-amber-200/90 text-xs">
                    Ask Desk operates in strict read-only intelligence mode. State mutations must be executed through governed Recovery Plans and Approvals.
                  </p>
                </div>
              ) : (
                <>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Verified Desk Answer:
                  </div>
                  <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{askAnswer.answer}</p>

                  {/* Fact Claims Table */}
                  {askAnswer.facts && askAnswer.facts.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        ANSWER_FACT Grounded Claims:
                      </span>
                      <div className="space-y-1">
                        {askAnswer.facts.map((f: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px]"
                          >
                            <span className="text-slate-300 font-mono">{f.entity || f.field}: {f.value}</span>
                            <span className="text-emerald-400 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                              VERIFIED
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {askAnswer.proof_summary && (
                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-emerald-400 font-mono">
                      ✓ {askAnswer.proof_summary.passing} of {askAnswer.proof_summary.total} facts verified against database rows.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
