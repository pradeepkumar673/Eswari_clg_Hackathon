/**
 * apps/web/src/hooks/useIncidents.ts
 * Open breakdowns and accidents, live. Also tells the notification bell to refresh.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, getStoredToken } from '../api/client.js';

export interface IncidentRecord {
  incident_id: string;
  kind: 'BREAKDOWN' | 'ACCIDENT' | 'DELAY_OTHER';
  status: string;
  truck_id: string;
  driver_id: string;
  driver_name: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  ts: string;
  warehouse_id: string | null;
  destination_code: string | null;
  proposal_id: string | null;
}

export function useIncidents() {
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [live, setLive] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.incidents.active();
      setIncidents(res.incidents || []);
    } catch {
      // No permission for this role, or offline: leave the list as it is
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === 'auth_ok') ws?.send(JSON.stringify({ type: 'subscribe', topic: 'incidents' }));
        if (m.type === 'subscribed' && m.topic === 'incidents') setLive(true);

        if (m.type === 'event' && m.topic === 'incidents' && m.data) {
          const d = m.data;
          if (d.type === 'INCIDENT_REPORTED' && d.incident) {
            setIncidents((prev) => [d.incident, ...prev.filter((i) => i.incident_id !== d.incident.incident_id)]);
          }
          if (d.type === 'INCIDENT_CLEARED') {
            setIncidents((prev) => prev.filter((i) => i.incident_id !== d.incident_id));
          }
          // Managers and admins: refresh the bell right away
          window.dispatchEvent(new Event('notifications:refresh'));
        }
      };
      ws.onclose = () => {
        setLive(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const clear = useCallback(async (incidentId: string) => {
    await api.incidents.clear(incidentId);
    setIncidents((prev) => prev.filter((i) => i.incident_id !== incidentId));
  }, []);

  return { incidents, live, refresh, clear };
}

