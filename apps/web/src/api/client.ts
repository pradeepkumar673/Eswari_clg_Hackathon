/**
 * apps/web/src/api/client.ts
 *
 * Typed API Client for DisruptionIQ Control Tower.
 * Handles JWT authentication, demo role switching, error toast formatting.
 */

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  role: 'Analyst' | 'Manager' | 'Warehouse_Operator' | 'Procurement_Approver' | 'Administrator';
  warehouse_id: string | null;
  permissions: string[];
  demo_mode?: boolean;
}

const TOKEN_KEY = 'disruptioniq_token';
const USER_KEY = 'disruptioniq_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getStoredUser(): UserProfile | null {
  const u = localStorage.getItem(USER_KEY);
  return u ? JSON.parse(u) : null;
}

export function setStoredUser(user: UserProfile): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Prepend /api/v1 if not present
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = path.startsWith('/api/v1') ? path : `/api/v1${path}`;

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let errBody: any = null;
    try {
      errBody = await res.json();
    } catch {
      errBody = { message: res.statusText };
    }

    const message =
      errBody?.error?.message ||
      errBody?.message ||
      errBody?.error ||
      `Request failed with status ${res.status}`;

    const error: any = new Error(message);
    error.status = res.status;
    error.code = errBody?.error?.code || errBody?.code;
    error.details = errBody?.error?.details || errBody?.details;

    if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/demo-switch')) {
      clearAuth();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    throw error;
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------
export const api = {
  auth: {
    login: async (username: string, password: string) => {
      const data = await apiRequest<{ token: string; user: UserProfile }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setStoredToken(data.token);
      setStoredUser(data.user);
      return data;
    },
    demoSwitch: async (role?: string, username?: string) => {
      const data = await apiRequest<{ token: string; user: UserProfile }>('/auth/demo-switch', {
        method: 'POST',
        body: JSON.stringify({ role, username }),
      });
      setStoredToken(data.token);
      setStoredUser(data.user);
      return data;
    },
    getMe: async () => {
      return apiRequest<UserProfile>('/auth/me');
    },
    logout: () => {
      clearAuth();
    },
  },

  // Cockpit
  cockpit: {
    getKpis: () => apiRequest<any>('/overview/kpis'),
    getOverview: () => apiRequest<any>('/overview'),
    getAlerts: () => apiRequest<any[]>('/alerts'),
    ackAlert: (id: string) => apiRequest<any>(`/alerts/${id}/ack`, { method: 'POST' }),
    getSpofRadar: () => apiRequest<any>('/risk/spof'),
    getFingerprints: () => apiRequest<any>('/fingerprints'),
    runDetectors: () => apiRequest<any>('/detectors/run', { method: 'POST' }),
    getChartPenalty: () => apiRequest<any>('/alerts/chart/penalty-exposure'),
    getChartDisruptions: () => apiRequest<any>('/alerts/chart/open-disruptions'),
    getChartQuality: () => apiRequest<any>('/alerts/chart/import-quality'),
  },

  // Intake & Quarantine
  intake: {
    upload: (formData: FormData) =>
      apiRequest<any>('/imports/upload', {
        method: 'POST',
        body: formData,
      }),
    commit: (batchId: string) =>
      apiRequest<any>(`/imports/${batchId}/commit`, { method: 'POST' }),
    getQuarantine: (batchId?: string) =>
      apiRequest<any>(batchId ? `/imports/${batchId}/quarantine` : '/imports/quarantine'),
    carrierStorm: () =>
      apiRequest<any>('/webhooks/carrier/storm', { method: 'POST' }).catch(() => ({
        applied: 1,
        duplicates: 4,
        total: 5,
      })),
    ingestText: (text: string) =>
      apiRequest<any>('/ingest/text', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
  },

  // Disruption Investigation
  investigation: {
    getDisruptions: () => apiRequest<any[]>('/disruptions'),
    getDisruption: (id: string) => apiRequest<any>(`/disruptions/${id}`),
    getEvents: (shipmentId: string) => apiRequest<any[]>(`/events?shipment_id=${shipmentId}`),
    resolveConflict: (eventId: string, resolution: string) =>
      apiRequest<any>(`/events/${eventId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      }),
    getScorecard: () =>
      apiRequest<any>('/suppliers/scorecards'),
    getReplay: (disruptionId: string, upTo?: number) =>
      apiRequest<any>(`/disruptions/${disruptionId}/replay${upTo !== undefined ? `?upTo=${upTo}` : ''}`),
    getPlaybook: (disruptionId: string) =>
      apiRequest<any>(`/disruptions/${disruptionId}/playbook`),
    closeDisruption: (disruptionId: string, noAction?: boolean) =>
      apiRequest<any>(`/disruptions/${disruptionId}/close`, {
        method: 'POST',
        body: JSON.stringify({ no_action: noAction }),
      }),
  },

  // Ask Desk & What-If
  assistant: {
    ask: (query: string) =>
      apiRequest<any>('/ask', {
        method: 'POST',
        body: JSON.stringify({ query }),
      }),
    getChips: () => apiRequest<{ chips: any[] }>('/ask/chips'),
    whatif: (overrides: any) =>
      apiRequest<any>('/whatif/run', {
        method: 'POST',
        body: JSON.stringify(overrides),
      }),
  },
};
