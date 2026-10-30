/**
 * apps/web/src/hooks/useWarehouses.ts
 *
 * Live warehouse list for every screen. Loads once, then refreshes whenever
 * anyone creates or changes a warehouse, using the 'warehouses' WebSocket topic.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, getStoredToken } from '../api/client.js';

export interface WarehouseRecord {
  _id: string;
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  map_x: number;
  map_y: number;
  footprint: Array<[number, number]> | null;
  processing_hours: number;
  is_hub: boolean;
  is_active: boolean;
}

export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWarehouses(await api.warehouses.list());
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Could not load warehouses');
    } finally {
      setLoading(false);
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
    let debounce: ReturnType<typeof setTimeout> | null = null;

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
        if (m.type === 'auth_ok') ws?.send(JSON.stringify({ type: 'subscribe', topic: 'warehouses' }));
        if (m.type === 'event' && m.topic === 'warehouses') {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(refresh, 200);
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (debounce) clearTimeout(debounce);
      ws?.close();
    };
  }, [refresh]);

  return { warehouses, loading, error, refresh };
}

