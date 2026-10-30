/**
 * apps/api/src/services/incidentFeed.ts
 * Turns an incident into live events: map marker update for everyone, and a bell notification for managers and admins.
 */

import { broadcastToTopic } from './websocket.js';
import { dispatchNotification } from './notifications.js';

export interface IncidentView {
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

export function toIncidentView(doc: any): IncidentView {
  return {
    incident_id: doc.incident_id,
    kind: doc.kind,
    status: doc.status,
    truck_id: doc.truck_id,
    driver_id: doc.driver_id,
    driver_name: doc.driver_name ?? null,
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    accuracy_m: doc.accuracy_m ?? null,
    ts: new Date(doc.ts).toISOString(),
    warehouse_id: doc.warehouse_id ?? null,
    destination_code: doc.destination_code ?? null,
    proposal_id: doc.proposal_id ?? null,
  };
}

/** Called right after a breakdown or accident is saved. */
export async function announceIncident(view: IncidentView): Promise<void> {
  // Every driver and every map viewer. Warehouse operators only get their own warehouse (filtered in websocket.ts).
  await broadcastToTopic('incidents', {
    type: 'INCIDENT_REPORTED',
    incident: view,
    warehouse_id: view.warehouse_id,
  });

  const where = view.lat != null && view.lng != null
    ? `${view.lat.toFixed(5)}, ${view.lng.toFixed(5)}`
    : 'position not sent';
  const who = view.driver_name ?? view.driver_id;
  const kindLabel = view.kind === 'ACCIDENT' ? 'Accident' : 'Breakdown';

  // Bell notification for managers and administrators. Deduplicated per incident id.
  await dispatchNotification({
    trigger: 'DRIVER_INCIDENT_REPORTED',
    template_key: 'driver_incident_tpl',
    title: `${kindLabel}: ${view.truck_id} (${who})`,
    body: `Reported live from the driver portal at ${where}.${
      view.destination_code ? ` Heading to ${view.destination_code}.` : ''
    }`,
    link_type: 'tracking',
    link_id: view.incident_id,
    entity_type: 'DriverIncident',
    entity_id: view.incident_id,
    target_roles: ['Manager', 'Administrator'],
  });
}

/** Called when an incident is marked cleared. Removes the marker everywhere. */
export async function announceClear(view: Pick<IncidentView, 'incident_id' | 'truck_id' | 'warehouse_id'>, clearedBy: string): Promise<void> {
  await broadcastToTopic('incidents', {
    type: 'INCIDENT_CLEARED',
    incident_id: view.incident_id,
    truck_id: view.truck_id,
    warehouse_id: view.warehouse_id,
    cleared_by: clearedBy,
  });
}

