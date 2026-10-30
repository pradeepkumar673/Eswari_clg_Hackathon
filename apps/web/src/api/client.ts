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
  role:
    | 'Analyst'
    | 'Manager'
    | 'Warehouse_Operator'
    | 'Procurement_Approver'
    | 'Administrator'
    | 'DRIVER'
    | 'SUPPLIER';
  warehouse_id: string | null;
  driver_id?: string | null;
  truck_id?: string | null;
  supplier_id?: string | null;
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
    listShipments: () => apiRequest<{ shipments: any[] }>('/investigation/shipments'),
    getShipment: (id: string) => apiRequest<any>(`/investigation/shipments/${encodeURIComponent(id)}`),
    getReplay: (id: string) => apiRequest<any>(`/investigation/shipments/${encodeURIComponent(id)}/replay`),
    resolveConflict: (conflictEventId: string, body: { chosen_event_id: string; reason: string }) =>
      apiRequest<any>(`/events/conflicts/${conflictEventId}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getScorecard: () => apiRequest<any>('/suppliers/scorecards'),
    getDisruptions: () => apiRequest<any[]>('/disruptions'),
    getDisruption: (id: string) => apiRequest<any>(`/disruptions/${id}`),
    getEvents: (shipmentId: string) => apiRequest<any[]>(`/events?shipment_id=${shipmentId}`),
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

  // Impact & Risk
  impact: {
    getRisks: (disruptionId: string) =>
      apiRequest<any>(`/disruptions/${disruptionId}/risks`),
    getImpact: (disruptionId: string) =>
      apiRequest<any>(`/disruptions/${disruptionId}/impact`),
    getHeatgrid: (disruptionId: string) =>
      apiRequest<any>(`/disruptions/${disruptionId}/heatgrid`),
    getEvidence: (type: string, id: string) =>
      apiRequest<any>(`/evidence/${type}/${id}`),
    getLineage: (orderId: string, disruptionId?: string) =>
      apiRequest<any>(`/orders/${orderId}/lineage${disruptionId ? `?disruption=${disruptionId}` : ''}`),
    getCover: () =>
      apiRequest<any>('/projections/cover'),
  },

  // Recovery Workbench
  recovery: {
    generatePlan: (disruptionId: string) =>
      apiRequest<any>(`/disruptions/${disruptionId}/recovery-plans`, { method: 'POST' }),
    getPlan: (planId: string) =>
      apiRequest<any>(`/plans/${planId}`),
    getTradeoffs: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/tradeoffs`),
    getCards: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/cards`),
    verifyPlan: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/verify`, { method: 'POST' }),
    challengePlan: (planId: string, claimText?: string, expected?: number, actual?: number) =>
      apiRequest<any>(`/plans/${planId}/challenge`, {
        method: 'POST',
        body: JSON.stringify({ claim_text: claimText, expected, actual }),
      }),
    clearChallenge: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/challenge`, { method: 'DELETE' }),
    submitPlan: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/submit`, { method: 'POST' }),
    getGuardrails: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/guardrails`),
    getPromiseDates: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/promise-dates`),
    updatePromiseDate: (planId: string, orderId: string, committedDate: string) =>
      apiRequest<any>(`/plans/${planId}/promise-dates`, {
        method: 'PATCH',
        body: JSON.stringify({ order_id: orderId, committed_date: committedDate }),
      }),
  },

  // Notifications
  notifications: {
    getNotifications: () =>
      apiRequest<{ notifications?: any[]; unread_count?: number } | any[]>('/notifications').then(
        (data) => (Array.isArray(data) ? data : data?.notifications ?? []),
      ),
    getOutbox: (channel?: string) =>
      apiRequest<{ outbox?: any[] } | any[]>(`/notifications/outbox${channel ? `?channel=${channel}` : ''}`).then(
        (data) => (Array.isArray(data) ? data : data?.outbox ?? []),
      ),
    markRead: (id: string) =>
      apiRequest<any>(`/notifications/${id}/read`, { method: 'PATCH' }),
  },

  // Master Data & Network
  incidents: {
    active: () => apiRequest<{ incidents: any[] }>('/incidents/active'),
    clear: (incidentId: string) =>
      apiRequest<any>(`/incidents/${incidentId}/clear`, { method: 'POST' }),
  },

  warehouses: {
    list: () => apiRequest<any[]>('/warehouses'),
    create: (body: {
      code: string;
      name: string;
      lat: number;
      lng: number;
      processing_hours?: number;
      is_hub?: boolean;
    }) => apiRequest<any>('/warehouses', { method: 'POST', body: JSON.stringify(body) }),
    update: (code: string, body: Record<string, unknown>) =>
      apiRequest<any>(`/warehouses/${code}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  network: {
    getNodes: async () => {
      const [whs, sups, lanes] = await Promise.all([
        apiRequest<any[]>('/warehouses').catch(() => []),
        apiRequest<any[]>('/admin/master/suppliers').catch(() => []),
        apiRequest<any[]>('/admin/master/lanes').catch(() => []),
      ]);
      return { warehouses: whs, suppliers: sups, lanes };
    },
  },

  // Approvals & Execution
  approvals: {
    getQueue: () => apiRequest<any[]>('/approvals/queue'),
    approve: (planId: string, role?: string, notes?: string) =>
      apiRequest<any>(`/plans/${planId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ role, notes }),
      }),
    reject: (planId: string, reason: string) =>
      apiRequest<any>(`/plans/${planId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    requestChanges: (planId: string, notes: string) =>
      apiRequest<any>(`/plans/${planId}/request-changes`, {
        method: 'POST',
        body: JSON.stringify({ notes }),
      }),
    execute: (planId: string) =>
      apiRequest<any>(`/plans/${planId}/execute`, { method: 'POST' }),
    rollback: (planId: string, reason?: string) =>
      apiRequest<any>(`/plans/${planId}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    getDelegations: () => apiRequest<any[]>('/approvals/delegations'),
    createDelegation: (data: { delegatee_id: string; role: string; expires_at: string; reason: string }) =>
      apiRequest<any>('/approvals/delegations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    revokeDelegation: (id: string) =>
      apiRequest<any>(`/approvals/delegations/${id}`, { method: 'DELETE' }),
    getNotices: () => apiRequest<any[]>('/customer-notices'),
    releaseNotice: (id: string) =>
      apiRequest<any>(`/customer-notices/${id}/release`, { method: 'POST' }),
  },

  // Audit & Security
  audit: {
    getRecords: (limit = 50) => apiRequest<any[]>(`/audit?limit=${limit}`),
    verifyChain: () => apiRequest<{ ok: boolean; checked: number; error?: string }>('/audit/verify'),
    tamperChain: () => apiRequest<any>('/admin/demo/tamper', { method: 'POST' }),
    runRedTeam: () => apiRequest<any>('/admin/red-team/run', { method: 'POST' }),
    getMasterData: (entity: string) => apiRequest<any[]>(`/admin/master/${entity}`),
    deactivateMasterData: (entity: string, id: string) =>
      apiRequest<any>(`/admin/master/${entity}/${id}`, { method: 'DELETE' }),
    createInventoryCorrection: (data: { warehouse_id: string; sku_id: string; delta: number; reason_code: string; notes?: string }) =>
      apiRequest<any>('/inventory/corrections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getScorecards: () => apiRequest<any[]>('/suppliers/scorecards'),
  },

  // Capacity Mapper & Inbound Plans
  capacity: {
    getFootprints: () => apiRequest<any>('/capacity/footprints'),
    saveFootprint: (code: string, polygon: Array<[number, number]>) =>
      apiRequest<any>(`/capacity/footprint/${code}`, { method: 'PUT', body: JSON.stringify({ polygon }) }),
    clearFootprint: (code: string) =>
      apiRequest<any>(`/capacity/footprint/${code}`, { method: 'DELETE' }),
    getZones: (warehouseId = 'WH-HOS') => apiRequest<any[]>(`/zones?warehouse_id=${warehouseId}`),
    getZone: (zoneId: string) => apiRequest<any>(`/zones/${zoneId}`),
    createZone: (data: any) => apiRequest<any>('/zones', { method: 'POST', body: JSON.stringify(data) }),
    patchZone: (zoneId: string, data: any) => apiRequest<any>(`/zones/${zoneId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteZone: (zoneId: string) => apiRequest<any>(`/zones/${zoneId}`, { method: 'DELETE' }),
    assignStock: (zoneId: string, skuId: string, units: number) =>
      apiRequest<any>(`/zones/${zoneId}/assignments`, { method: 'POST', body: JSON.stringify({ sku_id: skuId, units }) }),
    checkCapacity: (zoneId: string, shipmentId?: string, slots?: number) =>
      apiRequest<any>('/capacity/check', { method: 'POST', body: JSON.stringify({ zone_id: zoneId, shipment_id: shipmentId, slots }) }),
    createInboundPlan: (shipmentId: string, zoneId: string, slots?: number, planOverCapacity?: boolean) =>
      apiRequest<any>('/capacity/inbound-plans', {
        method: 'POST',
        body: JSON.stringify({ shipment_id: shipmentId, zone_id: zoneId, slots, plan_over_capacity: planOverCapacity }),
      }),
    deleteInboundPlan: (planId: string) => apiRequest<any>(`/capacity/inbound-plans/${planId}`, { method: 'DELETE' }),
    getOverview: (warehouseId = 'WH-HOS') => apiRequest<any>(`/capacity/overview?warehouse_id=${warehouseId}`),
  },

  // Supplier Claims
  claims: {
    getClaims: (supplierId?: string) => apiRequest<any[]>(`/claims${supplierId ? `?supplier_id=${supplierId}` : ''}`),
    getClaim: (id: string) => apiRequest<any>(`/claims/${id}`),
    respond: (id: string, response: string) => apiRequest<any>(`/claims/${id}/respond`, { method: 'POST', body: JSON.stringify({ response }) }),
    decide: (id: string, decision: 'ACCEPT' | 'PARTIAL' | 'REJECT', notes: string) =>
      apiRequest<any>(`/claims/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision, notes }) }),
  },

  // CCTV Vision & Evidence
  cctv: {
    getClips: (warehouseId?: string) => apiRequest<any[]>(`/cctv/clips${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`),
    getEvents: (warehouseId?: string) => apiRequest<any[]>(`/cctv/events${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`),
    getHotspots: (warehouseId?: string) => apiRequest<any[]>(`/cctv/hotspots${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`),
    linkEvent: (eventId: string, shipmentId?: string) =>
      apiRequest<any>(`/cctv/events/${eventId}/link`, { method: 'POST', body: JSON.stringify({ shipment_id: shipmentId }) }),
    verifyEvidence: (evidenceId: string) => apiRequest<any>(`/evidence/${evidenceId}/verify`),
    tamperEvidence: (evidenceId: string) => apiRequest<any>(`/evidence/${evidenceId}/tamper`, { method: 'POST' }),
  },

  // Live Driver Tracking & Reroutes
  tracking: {
    getTrucks: () => apiRequest<any[]>('/tracking/trucks'),
    getPositions: () => apiRequest<any[]>('/tracking/positions'),
    getReroutes: (status?: string) => apiRequest<any[]>(`/tracking/reroutes${status ? `?status=${status}` : ''}`),
    approveReroute: (id: string, notes?: string) =>
      apiRequest<any>(`/tracking/reroutes/${id}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
    rejectReroute: (id: string, notes?: string) =>
      apiRequest<any>(`/tracking/reroutes/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),
  },
};
