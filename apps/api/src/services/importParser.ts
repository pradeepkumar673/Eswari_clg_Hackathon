/**
 * apps/api/src/services/importParser.ts
 *
 * Robust CSV and JSON parser for import files, with SHA-256 hash calculation.
 * Preserves raw input string untouched.
 */

import crypto from 'node:crypto';

export interface ParsedImportData {
  fileHash: string;
  rawContent: string;
  rows: Record<string, unknown>[];
}

/**
 * Computes SHA-256 hash of a buffer or string.
 */
export function computeFileHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Parses raw CSV text into array of object records.
 * Handles quoted cells with commas, trimmed column names, and empty rows.
 */
export function parseCsv(csvText: string): Record<string, unknown>[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return [];
  }

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, unknown> = {};
    for (let h = 0; h < headers.length; h++) {
      const header = headers[h];
      const rawVal = values[h] ?? '';
      row[header] = coerceValue(rawVal);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Coerces string values to numbers or booleans when unambiguously appropriate.
 */
function coerceValue(val: string): unknown {
  if (val === '') return '';
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;
  // Check if integer or float
  if (/^-?\d+$/.test(val)) {
    const num = Number.parseInt(val, 10);
    if (!Number.isNaN(num)) return num;
  }
  if (/^-?\d+\.\d+$/.test(val)) {
    const num = Number.parseFloat(val);
    if (!Number.isNaN(num)) return num;
  }
  return val;
}

/**
 * Parses buffer or string according to format (CSV or JSON).
 */
export function parseImportBuffer(
  buffer: Buffer,
  filename: string,
): ParsedImportData {
  const rawContent = buffer.toString('utf-8');
  const fileHash = computeFileHash(buffer);

  let rows: Record<string, unknown>[] = [];
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.json') || rawContent.trim().startsWith('[') || rawContent.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        rows = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        rows = Array.isArray((parsed as any).rows) ? (parsed as any).rows : [parsed];
      }
    } catch {
      // If JSON parse fails, attempt fallback to CSV
      rows = parseCsv(rawContent);
    }
  } else {
    rows = parseCsv(rawContent);
  }

  return {
    fileHash,
    rawContent,
    rows,
  };
}

