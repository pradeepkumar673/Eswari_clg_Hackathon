/**
 * apps/web/src/hooks/useLiveRefresh.ts
 * Calls refresh() when any of the given WebSocket topics reports a change, plus a slow poll as fallback.
 */

import { useEffect } from 'react';
import { getStoredToken } from '../api/client.js';

export function useLiveRefresh(topics: string[], refresh: () => void, pollMs = 15000) {
  const key = topics.join(',');

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, pollMs);

    const token = getStoredToken();
    if (!token) return () => clearInterval(poll);

    const wanted = new Set(key.split(','));
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, 250);
    };

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
        if (m.type === 'auth_ok') {
          wanted.forEach((topic) => ws?.send(JSON.stringify({ type: 'subscribe', topic })));
        }
        if (m.type === 'event' && wanted.has(m.topic)) trigger();
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      if (debounce) clearTimeout(debounce);
      ws?.close();
    };
  }, [key, refresh, pollMs]);
}

