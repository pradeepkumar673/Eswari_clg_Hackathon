/**
 * apps/api/src/services/websocket.ts
 *
 * Real-time WebSocket Shell attached to Express HTTP server at /ws.
 * Specifications:
 * - Path: /ws
 * - First message must be { type: "auth", token: string }
 * - Reject anything else, close socket after 5s without auth
 * - Re-checks permission on every subscription (live role updates take effect immediately)
 * - Subscription topics: tracking, cctv, zones, presence, alerts
 * - Filters every broadcast by caller's role and scope (driver sees only own truck; operator sees own warehouse)
 * - Tokens never appear in URLs or logs
 */

import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/users.js';
import { Warehouse } from '../models/warehouses.js';
import { logger } from '../logger.js';
import { hasPermission, Role, Capability } from '@disruptioniq/shared';

export interface ClientConnection {
  ws: WebSocket;
  isAuthenticated: boolean;
  authTimer: NodeJS.Timeout | null;
  userId: string | null;
  username: string | null;
  role: Role | null;
  warehouse_id: string | null;
  driver_id: string | null;
  truck_id: string | null;
  supplier_id: string | null;
  subscriptions: Set<string>;
}

let wss: WebSocketServer | null = null;
const clients = new Map<WebSocket, ClientConnection>();

export type SubscriptionTopic = 'tracking' | 'cctv' | 'zones' | 'capacity' | 'presence' | 'alerts' | 'driver' | 'shipments';

const TOPIC_PERMISSIONS: Record<SubscriptionTopic, Capability[]> = {
  tracking: ['tracking.read.all', 'tracking.read.warehouse', 'tracking.read.own'],
  cctv: ['cctv.view'],
  zones: ['capacity.view'],
  capacity: ['capacity.view'],
  presence: ['presence.read'],
  alerts: ['view_cockpit'],
  driver: ['driver.ping'],
  shipments: ['view_cockpit'],
};

/**
 * Initializes and attaches WebSocketServer to the given HTTP server.
 */
export function initWebSocketServer(server: HttpServer): WebSocketServer {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const state: ClientConnection = {
      ws,
      isAuthenticated: false,
      authTimer: null,
      userId: null,
      username: null,
      role: null,
      warehouse_id: null,
      driver_id: null,
      truck_id: null,
      supplier_id: null,
      subscriptions: new Set<string>(),
    };

    clients.set(ws, state);

    // Close socket after 5s if unauthenticated
    state.authTimer = setTimeout(() => {
      if (!state.isAuthenticated) {
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout (5 seconds)' }));
          ws.close(4001, 'Authentication timeout');
        } catch {
          // Socket already closed
        }
      }
    }, 5000);

    ws.on('message', async (data: any) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Malformed JSON message' }));
        if (!state.isAuthenticated) {
          ws.close(4002, 'Malformed authentication payload');
        }
        return;
      }

      // Step 1: Enforce authentication as first message
      if (!state.isAuthenticated) {
        if (message.type !== 'auth' || !message.token) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'First message must be { type: "auth", token: "..." }',
            }),
          );
          ws.close(4002, 'First message must be auth');
          return;
        }

        try {
          const payload = jwt.verify(message.token, config.JWT_SECRET) as {
            sub: string;
            username: string;
            role: Role;
          };

          const userDoc = await User.findById(payload.sub).lean();
          if (!userDoc) {
            ws.send(JSON.stringify({ type: 'error', message: 'User account not found' }));
            ws.close(4004, 'User not found');
            return;
          }

          if (state.authTimer) {
            clearTimeout(state.authTimer);
            state.authTimer = null;
          }

          state.isAuthenticated = true;
          state.userId = userDoc._id.toString();
          state.username = userDoc.username;
          state.role = userDoc.role;
          state.warehouse_id = (payload as any).warehouse_id || (userDoc.warehouse_id ? userDoc.warehouse_id.toString() : null);
          state.driver_id = (payload as any).driver_id || userDoc.driver_id || null;
          state.truck_id = (payload as any).truck_id || userDoc.truck_id || null;
          state.supplier_id = (payload as any).supplier_id || userDoc.supplier_id || null;

          ws.send(
            JSON.stringify({
              type: 'auth_ok',
              user: {
                username: userDoc.username,
                role: userDoc.role,
                driver_id: userDoc.driver_id,
                truck_id: userDoc.truck_id,
                supplier_id: userDoc.supplier_id,
                warehouse_id: state.warehouse_id,
              },
            }),
          );
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
          ws.close(4003, 'Invalid token');
        }
        return;
      }

      // Step 2: Handle authenticated actions
      if (message.type === 'subscribe') {
        const topic = message.topic as SubscriptionTopic;
        if (!topic || !TOPIC_PERMISSIONS[topic]) {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown topic: ${topic}` }));
          return;
        }

        // Live check user from DB: changed role takes effect immediately
        const liveUser = await User.findById(state.userId).lean();
        if (liveUser) {
          state.role = liveUser.role;
          if (!state.warehouse_id) {
            state.warehouse_id = liveUser.warehouse_id ? liveUser.warehouse_id.toString() : null;
          }
          if (!state.driver_id) state.driver_id = liveUser.driver_id || null;
          if (!state.truck_id) state.truck_id = liveUser.truck_id || null;
          if (!state.supplier_id) state.supplier_id = liveUser.supplier_id || null;
        }

        const requiredCaps = TOPIC_PERMISSIONS[topic];
        const hasAccess = requiredCaps.some((cap) => hasPermission(state.role!, cap));

        if (!hasAccess) {
          ws.send(
            JSON.stringify({
              type: 'error',
              topic,
              message: `Forbidden: Role '${state.role}' lacks permission for topic '${topic}'`,
            }),
          );
          return;
        }

        state.subscriptions.add(topic);
        ws.send(JSON.stringify({ type: 'subscribed', topic }));
        return;
      }

      if (message.type === 'unsubscribe') {
        state.subscriptions.delete(message.topic);
        ws.send(JSON.stringify({ type: 'unsubscribed', topic: message.topic }));
        return;
      }

      if (message.type === 'viewing') {
        const viewingPayload = {
          user_id: state.userId,
          username: state.username,
          role: state.role,
          kind: message.kind,
          id: message.id,
          ts: new Date().toISOString(),
        };
        await broadcastToTopic('presence', viewingPayload);
        return;
      }

      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
    });

    ws.on('close', () => {
      if (state.authTimer) {
        clearTimeout(state.authTimer);
      }
      clients.delete(ws);
    });

    ws.on('error', () => {
      if (state.authTimer) {
        clearTimeout(state.authTimer);
      }
      clients.delete(ws);
    });
  });

  return wss;
}

/**
 * Broadcasts an event to all subscribed clients, filtering by role and scope.
 */
export async function broadcastToTopic(
  topic: SubscriptionTopic,
  payload: any,
): Promise<void> {
  if (!wss) return;

  for (const [, client] of clients) {
    if (!client.isAuthenticated || !client.subscriptions.has(topic) || !client.role) {
      continue;
    }

    // Role and Scope Server-Side Filter
    let filteredPayload: any = null;

    if (topic === 'tracking') {
      const roleUpper = client.role.toUpperCase();
      if (roleUpper === 'DRIVER') {
        // Driver socket receives only its own truck's frames
        if (Array.isArray(payload)) {
          const match = payload.filter(
            (p) =>
              (client.truck_id && p.truck_id === client.truck_id) ||
              (client.driver_id && p.driver_id === client.driver_id),
          );
          if (match.length > 0) filteredPayload = match;
        } else if (
          (client.truck_id && payload.truck_id === client.truck_id) ||
          (client.driver_id && payload.driver_id === client.driver_id)
        ) {
          filteredPayload = payload;
        }
      } else if (client.role === 'Warehouse_Operator') {
        // Operator receives only tracking feeding assigned warehouse
        if (client.warehouse_id) {
          const userWhDoc = await Warehouse.findById(client.warehouse_id).lean();
          const matchesWh = (item: any) =>
            item.warehouse_id === client.warehouse_id ||
            item.destination_warehouse === client.warehouse_id ||
            item.destination_warehouse_id === client.warehouse_id ||
            (userWhDoc && (item.warehouse_id === userWhDoc.code || item.destination_warehouse === userWhDoc.code || item.destination_warehouse_id === userWhDoc.code));

          if (Array.isArray(payload)) {
            const match = payload.filter(matchesWh);
            if (match.length > 0) filteredPayload = match;
          } else if (matchesWh(payload)) {
            filteredPayload = payload;
          }
        }
      } else {
        // Analysts, Managers, Admins get unfiltered network tracking
        filteredPayload = payload;
      }
    } else if (topic === 'cctv' || topic === 'zones' || topic === 'capacity') {
      if (client.role === 'Warehouse_Operator' && client.warehouse_id) {
        const userWhDoc = await Warehouse.findById(client.warehouse_id).lean();
        const matchesWh = (item: any) =>
          item.warehouse_id === client.warehouse_id ||
          (userWhDoc && item.warehouse_id === userWhDoc.code);

        if (Array.isArray(payload)) {
          const match = payload.filter(matchesWh);
          if (match.length > 0) filteredPayload = match;
        } else if (matchesWh(payload)) {
          filteredPayload = payload;
        }
      } else {
        filteredPayload = payload;
      }
    } else if (topic === 'driver') {
      const targets: string[] = Array.isArray(payload.target_driver_ids) ? payload.target_driver_ids : [];
      filteredPayload = client.driver_id && targets.includes(client.driver_id) ? payload : null;
    } else if (topic === 'shipments') {
      if (client.role === 'Warehouse_Operator' && client.warehouse_id) {
        filteredPayload = payload.warehouse_id === client.warehouse_id ? payload : null;
      } else {
        filteredPayload = payload;
      }
    } else {
      // presence, alerts
      filteredPayload = payload;
    }

    if (filteredPayload !== null) {
      try {
        client.ws.send(
          JSON.stringify({
            type: 'event',
            topic,
            data: filteredPayload,
          }),
        );
      } catch {
        // Ignore dead socket errors
      }
    }
  }
}

/**
 * Returns current connected clients count.
 */
export function getConnectedClientCount(): number {
  return clients.size;
}

/**
 * Closes the WebSocket server instance.
 */
export async function closeWebSocketServer(): Promise<void> {
  if (wss) {
    for (const [, client] of clients) {
      if (client.authTimer) clearTimeout(client.authTimer);
      try {
        client.ws.close();
      } catch {}
    }
    clients.clear();
    await new Promise<void>((resolve) => {
      wss!.close(() => resolve());
    });
    wss = null;
  }
}

