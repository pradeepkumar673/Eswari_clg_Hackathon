/**
 * apps/api/src/fixtures/sampleMessages.ts
 *
 * Demo text/email fixtures for the "Use sample" buttons (micro-feature B15).
 * These are ONLY served through the sample API endpoint; they are never
 * auto-ingested. Raw text is stored untouched; nothing becomes an event
 * until a human confirms.
 *
 * Scenario B three messages:
 *   1. Supplier email: SHP-310 ETA 01:00 tomorrow (conflicts with carrier's 16:00 → 9h gap > 4h tolerance)
 *   2. Exact duplicate of that email (same external_event_id when normalised)
 *   3. SMS naming an unknown shipment SHP-999 (REJECTED: unknown reference)
 */

export interface SampleMessage {
  id: string;
  label: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  from: string;
  subject?: string;
  body: string;
  expected_outcome: 'CONFLICT' | 'DUPLICATE' | 'REJECTED';
  expected_reason: string;
}

export const SAMPLE_MESSAGES: SampleMessage[] = [
  {
    id: 'SAMPLE-1',
    label: 'Supplier email: SHP-310 ETA update (conflict)',
    channel: 'EMAIL',
    from: 'dispatch@precisioncomponents.in',
    subject: 'Shipment SHP-310 — ETA Revised',
    body: `Dear Team,

This is to inform you that shipment SHP-310 (60 units Control Module ECU, SKU-205) 
dispatched from our Chennai facility has encountered minor port clearance delays.

Revised ETA: 01:00 hours IST tomorrow (2026-11-02).

We apologise for any inconvenience. Please adjust your receiving schedule accordingly.

Regards,
Precision Components Ltd — Dispatch Desk
shipment_ref: SHP-310 | revision_id: EVT-2001`,
    expected_outcome: 'CONFLICT',
    expected_reason: 'Carrier API ETA (16:00) and Supplier Portal ETA (01:00 next day) differ by 9 hours, exceeding 4-hour tolerance. Conflict card raised.',
  },
  {
    id: 'SAMPLE-2',
    label: 'Exact duplicate of supplier email (duplicate)',
    channel: 'EMAIL',
    from: 'dispatch@precisioncomponents.in',
    subject: 'Shipment SHP-310 — ETA Revised',
    body: `Dear Team,

This is to inform you that shipment SHP-310 (60 units Control Module ECU, SKU-205) 
dispatched from our Chennai facility has encountered minor port clearance delays.

Revised ETA: 01:00 hours IST tomorrow (2026-11-02).

We apologise for any inconvenience. Please adjust your receiving schedule accordingly.

Regards,
Precision Components Ltd — Dispatch Desk
shipment_ref: SHP-310 | revision_id: EVT-2001`,
    expected_outcome: 'DUPLICATE',
    expected_reason: 'Same (source, external_event_id) as a previously ingested event. Stored as history, no state change.',
  },
  {
    id: 'SAMPLE-3',
    label: 'SMS with unknown shipment SHP-999 (rejected)',
    channel: 'SMS',
    from: '+919876543210',
    body: 'SHP-999 truck broke down near Krishnagiri toll. Delivery delayed 6 hours. Driver Ramesh 9845001234.',
    expected_outcome: 'REJECTED',
    expected_reason: 'Shipment reference SHP-999 not found in database. Event quarantined with reason UNKNOWN_SHIPMENT_REFERENCE.',
  },
];

/**
 * Sample voice transcript for the "Use sample transcript" button (W1).
 * Represents a Tanglish field report from a warehouse operator.
 */
export const SAMPLE_VOICE_TRANSCRIPT = {
  id: 'VOICE-SAMPLE-1',
  label: 'Sample Tanglish transcript: SHP-204 Hosur damage report',
  raw_transcript: 'SHP-204 Hosur warehouse-la 70 box damage, lorry rendu mani neram late',
  expected_extraction: {
    shipment_code: 'SHP-204',
    warehouse_code: 'WH-HOS',
    damaged_units: 70,
    delay_hours: 2,
    confidence: 0.94,
  },
};

