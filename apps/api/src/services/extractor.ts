/**
 * apps/api/src/services/extractor.ts
 *
 * Deterministic rule-based extractor for Tanglish and English field reports,
 * voice transcripts, emails, and SMS messages (W1, B15).
 * Also integrates with LLM wrapper (if GROQ_API_KEY is configured).
 */

import { callStructuredLLM, LLMUnavailable } from '../llm/provider.js';

export interface ExtractedEventCard {
  shipment_code: string | null;
  warehouse_code: string | null;
  event_type: 'DAMAGE_REPORT' | 'DELAY_REPORT' | 'ETA_UPDATE';
  damaged_units: number | null;
  delay_hours: number | null;
  confidence: number;
  tamil_labels: Record<string, string>;
  llm_used: boolean;
}

export const TAMIL_LABELS: Record<string, string> = {
  shipment_code: 'சரக்கு எண் (Shipment Code)',
  warehouse_code: 'கிடங்கு (Warehouse)',
  event_type: 'நிகழ்வு வகை (Event Type)',
  damaged_units: 'சேதமடைந்த பெட்டிகள் (Damaged Units)',
  delay_hours: 'தாமத நேரம் (Delay Hours)',
  confidence: 'நம்பகத்தன்மை (Confidence)',
};

const TANGLISH_NUMBERS: Record<string, number> = {
  onnu: 1,
  oru: 1,
  rendu: 2,
  irandu: 2,
  moonu: 3,
  moondru: 3,
  naalu: 4,
  naangu: 4,
  anju: 5,
  aindhu: 5,
  aaru: 6,
  ezhu: 7,
  ettu: 8,
  onbadhu: 9,
  pathu: 10,
};

function parseNumber(token: string): number | null {
  const clean = token.toLowerCase().trim();
  if (/^\d+$/.test(clean)) {
    return parseInt(clean, 10);
  }
  if (clean in TANGLISH_NUMBERS) {
    return TANGLISH_NUMBERS[clean];
  }
  return null;
}

export function extractEventCardRules(text: string): ExtractedEventCard {
  const lower = text.toLowerCase();

  // 1. Shipment code
  const shipmentMatch = text.match(/SHP-\d+/i);
  const shipment_code = shipmentMatch ? shipmentMatch[0].toUpperCase() : null;

  // 2. Warehouse
  let warehouse_code: string | null = null;
  if (/hosur|wh-hos|\bhos\b/i.test(lower)) {
    warehouse_code = 'WH-HOS';
  } else if (/chennai|wh-chn|\bchn\b/i.test(lower)) {
    warehouse_code = 'WH-CHN';
  } else if (/bengaluru|bangalore|wh-blr|\bblr\b/i.test(lower)) {
    warehouse_code = 'WH-BLR';
  }

  // 3. Damaged units
  let damaged_units: number | null = null;
  // Match patterns like "70 box damage", "pathu box damage", "50 units damage", "damage 70 box"
  const damageRegexes = [
    /(\w+|\d+)\s+(?:box|boxes|units|pieces|case|cases)\s+(?:damage|damaged|udanchu)/i,
    /(\w+|\d+)\s+(?:box|boxes|units|pieces)\b/i,
    /(?:damage|damaged)\s+(?:of\s+)?(\w+|\d+)\s*(?:box|boxes|units|pieces)?/i,
    /(\d+)\s+damaged/i,
  ];

  for (const regex of damageRegexes) {
    const m = lower.match(regex);
    if (m && m[1]) {
      const num = parseNumber(m[1]);
      if (num !== null && num > 0) {
        damaged_units = num;
        break;
      }
    }
  }

  // 4. Delay hours
  let delay_hours: number | null = null;
  // Match Tanglish e.g. "rendu mani neram late", "2 hours late", "3 hrs delay", "oru mani neram"
  const delayRegexes = [
    /(\w+|\d+)\s+mani\s+neram(?:\s+late|\s+delay)?/i,
    /(\w+|\d+)\s+(?:hours?|hrs?)\s+(?:late|delay|delayed)/i,
    /delay(?:ed)?\s+(?:by\s+)?(\w+|\d+)\s+(?:hours?|hrs?|mani\s+neram)/i,
    /(\d+)\s+(?:hours?|hrs?)\b/i,
  ];

  for (const regex of delayRegexes) {
    const m = lower.match(regex);
    if (m && m[1]) {
      const num = parseNumber(m[1]);
      if (num !== null && num > 0) {
        delay_hours = num;
        break;
      }
    }
  }

  // 5. Event type
  let event_type: 'DAMAGE_REPORT' | 'DELAY_REPORT' | 'ETA_UPDATE' = 'ETA_UPDATE';
  if (damaged_units !== null && damaged_units > 0) {
    event_type = 'DAMAGE_REPORT';
  } else if (delay_hours !== null && delay_hours > 0) {
    event_type = 'DELAY_REPORT';
  }

  // 6. Confidence calculation
  let confidence = 0.0;
  if (shipment_code) confidence += 0.35;
  if (warehouse_code) confidence += 0.25;
  if (damaged_units !== null) confidence += 0.20;
  if (delay_hours !== null) confidence += 0.14;

  confidence = Math.round(confidence * 100) / 100;

  return {
    shipment_code,
    warehouse_code,
    event_type,
    damaged_units,
    delay_hours,
    confidence,
    tamil_labels: TAMIL_LABELS,
    llm_used: false,
  };
}

export async function extractEventCard(text: string): Promise<ExtractedEventCard> {
  // Try LLM first if GROQ_API_KEY is configured
  try {
    const llmResult = await callStructuredLLM<{
      shipment_code?: string;
      warehouse_code?: string;
      event_type?: 'DAMAGE_REPORT' | 'DELAY_REPORT' | 'ETA_UPDATE';
      damaged_units?: number;
      delay_hours?: number;
      confidence?: number;
    }>({
      prompt: `Extract supply chain incident data from this message:\n"${text}"`,
      systemPrompt:
        'You are an expert logistics event parser. Extract shipment_code, warehouse_code (WH-HOS, WH-CHN, WH-BLR), event_type (DAMAGE_REPORT, DELAY_REPORT, ETA_UPDATE), damaged_units (integer), delay_hours (integer), and confidence (0.0 to 1.0). Return pure JSON.',
      promptType: 'EXTRACTION',
    });

    const d = llmResult.data;
    if (d && (d.shipment_code || d.warehouse_code || d.damaged_units || d.delay_hours)) {
      return {
        shipment_code: d.shipment_code || null,
        warehouse_code: d.warehouse_code || null,
        event_type: d.event_type || (d.damaged_units ? 'DAMAGE_REPORT' : 'DELAY_REPORT'),
        damaged_units: d.damaged_units ?? null,
        delay_hours: d.delay_hours ?? null,
        confidence: d.confidence ?? 0.95,
        tamil_labels: TAMIL_LABELS,
        llm_used: true,
      };
    }
  } catch (err) {
    if (!(err instanceof LLMUnavailable)) {
      // Fall through to deterministic rules
    }
  }

  // Fallback to rule-based extractor
  return extractEventCardRules(text);
}
