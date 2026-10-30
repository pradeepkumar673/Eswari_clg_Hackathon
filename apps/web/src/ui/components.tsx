/**
 * apps/web/src/ui/components.tsx
 *
 * Impeccable Design System Components for DisruptionIQ Control Tower.
 *
 * Design Guidelines:
 * - Desktop-first, calm, high-trust precision
 * - Explicit Text + Color chips
 * - INR locale formatting (₹ en-IN)
 * - Asia/Kolkata timestamps
 * - Loading, empty, error, and success states on all components
 */

import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  X,
} from 'lucide-react';

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:pointer-events-none select-none';

  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 focus:ring-indigo-500',
    secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 focus:ring-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-500',
    ghost: 'bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white',
    outline: 'border border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white',
  };

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-3.5 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-100',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-100',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// StatusChip (Text + Colour)
// ---------------------------------------------------------------------------
export function StatusChip({
  status,
  label,
  className,
}: {
  status: 'APPLIED' | 'DUPLICATE' | 'STALE' | 'CONFLICT' | 'REJECTED' | 'HELD' | 'APPROVED' | 'OPEN' | 'RESOLVED' | string;
  label?: string;
  className?: string;
}) {
  const upper = (status || '').toUpperCase();
  const text = label || upper;

  let style = 'bg-slate-800 text-slate-300 border-slate-700';

  if (['APPLIED', 'APPROVED', 'RESOLVED', 'PASS', 'ACTIVE'].includes(upper)) {
    style = 'bg-emerald-950/60 text-emerald-400 border-emerald-800';
  } else if (['CONFLICT', 'BREACH', 'REJECTED', 'CRITICAL', 'FAIL'].includes(upper)) {
    style = 'bg-red-950/60 text-red-400 border-red-800';
  } else if (['STALE', 'DUPLICATE', 'HELD', 'PENDING', 'WARNING'].includes(upper)) {
    style = 'bg-amber-950/60 text-amber-400 border-amber-800';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium border',
        style,
        className,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RiskBandChip
// ---------------------------------------------------------------------------
export function RiskBandChip({
  band,
  score,
  className,
}: {
  band?: 'RED' | 'AMBER' | 'GREEN' | string | null;
  score?: number | null;
  className?: string;
}) {
  const b = (band || (score !== undefined && score !== null ? (score >= 70 ? 'RED' : score >= 35 ? 'AMBER' : 'GREEN') : 'GREEN')).toUpperCase();

  let style = 'bg-emerald-950/60 text-emerald-400 border-emerald-800';
  if (b === 'RED') {
    style = 'bg-red-950/60 text-red-400 border-red-800';
  } else if (b === 'AMBER') {
    style = 'bg-amber-950/60 text-amber-400 border-amber-800';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-semibold border',
        style,
        className,
      )}
    >
      <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
      {b} {score !== undefined && score !== null ? `(${Math.round(score)})` : ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MoneyText (INR Formatting en-IN ₹)
// ---------------------------------------------------------------------------
export function MoneyText({
  amount,
  amountInr,
  className,
}: {
  amount?: number | null | undefined;
  amountInr?: number | null | undefined;
  className?: string;
}) {
  const val = amount !== undefined ? amount : amountInr;
  if (val === null || val === undefined) return <span className="font-mono text-slate-500">—</span>;

  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);

  return <span className={cn('font-mono font-medium text-slate-100', className)}>{formatted}</span>;
}

// ---------------------------------------------------------------------------
// TimeText (Asia/Kolkata IST)
// ---------------------------------------------------------------------------
export function TimeText({
  date,
  iso,
  format = 'full',
  className,
}: {
  date?: Date | string | null | undefined;
  iso?: string;
  format?: 'full' | 'short' | 'timeOnly';
  className?: string;
}) {
  const targetDate = date !== undefined ? date : iso;
  if (!targetDate) return <span className="font-mono text-slate-500">—</span>;

  const d = new Date(targetDate);
  if (isNaN(d.getTime())) return <span className="font-mono text-slate-500">Invalid</span>;

  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    hour12: false,
  };

  if (format === 'timeOnly') {
    options.hour = '2-digit';
    options.minute = '2-digit';
  } else if (format === 'short') {
    options.day = '2-digit';
    options.month = 'short';
    options.hour = '2-digit';
    options.minute = '2-digit';
  } else {
    options.day = '2-digit';
    options.month = 'short';
    options.year = 'numeric';
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  const str = new Intl.DateTimeFormat('en-IN', options).format(d);

  return (
    <span className={cn('font-mono text-xs text-slate-300', className)} title={`${d.toISOString()} (UTC)`}>
      {str} IST
    </span>
  );
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------
export function KpiCard({
  title,
  value,
  subvalue,
  status = 'default',
  onClick,
  active = false,
}: {
  title: string;
  value: number | string;
  subvalue?: string;
  status?: 'default' | 'danger' | 'warning' | 'success';
  onClick?: () => void;
  active?: boolean;
}) {
  const statusColors = {
    default: 'text-slate-100',
    danger: 'text-red-400',
    warning: 'text-amber-400',
    success: 'text-emerald-400',
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-4 rounded-lg bg-slate-900 border transition-all select-none',
        onClick ? 'cursor-pointer hover:border-slate-600' : '',
        active ? 'border-indigo-500 ring-1 ring-indigo-500 bg-slate-800/80' : 'border-slate-800',
      )}
    >
      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</div>
      <div className={cn('text-2xl font-mono font-bold mt-1.5', statusColors[status])}>
        {value}
      </div>
      {subvalue && <div className="text-xs text-slate-500 mt-1">{subvalue}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProofChip
// ---------------------------------------------------------------------------
export function ProofChip({
  passing,
  total,
  className,
}: {
  passing: number;
  total: number;
  className?: string;
}) {
  const allPass = passing === total && total > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold border',
        allPass
          ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
          : 'bg-amber-950/60 text-amber-400 border-amber-800',
        className,
      )}
    >
      {allPass ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      {passing}/{total} CLAIMS VERIFIED
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-slate-800/80', className)} />;
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-slate-800 rounded-lg">
      <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-slate-500 mb-3">
        <HelpCircle className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {description && <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">{description}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="p-4 rounded-lg bg-red-950/40 border border-red-900/60 text-red-200 text-sm flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5">
        <XCircle className="w-5 h-5 text-red-400 shrink-0" />
        <span>{message || 'An error occurred while loading data.'}</span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="border-red-800 text-red-200 hover:bg-red-950">
          Retry
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog (Modal)
// ---------------------------------------------------------------------------
export function Dialog({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer (Side Panel)
// ---------------------------------------------------------------------------
export function Drawer({
  isOpen,
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
}: {
  isOpen?: boolean;
  open?: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  const isVisible = isOpen ?? open ?? false;
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div
        className={cn(
          'w-full h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col',
          width,
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
