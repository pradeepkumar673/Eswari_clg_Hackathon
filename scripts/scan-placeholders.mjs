import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_WORDS = [
  'lorem',
  'TODO',
  'FIXME',
  'placeholder',
  'mock',
  'dummy',
  'coming soon',
  'not implemented',
  'fake'
];

// Scan apps/web/src for forbidden words and hardcoded currency symbols
const targetDir = path.resolve('apps/web/src');
let hitCount = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && /\.(tsx?|jsx?|html|css)$/.test(entry.name)) {
      scanFile(fullPath);
    }
  }
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Check forbidden keywords
    for (const word of FORBIDDEN_WORDS) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(line)) {
        console.error(`${filePath}:${index + 1}: Found forbidden word "${word}": ${line.trim()}`);
        hitCount++;
      }
    }

    // Check hardcoded ₹ amounts (e.g. ₹100, ₹ 500)
    if (/₹\s*\d+/.test(line)) {
      console.error(`${filePath}:${index + 1}: Found hardcoded currency symbol: ${line.trim()}`);
      hitCount++;
    }
  });
}

console.log('Scanning apps/web/src for placeholders and hardcoded numbers...');
scanDir(targetDir);

if (hitCount > 0) {
  console.error(`\nPlaceholder scan FAILED: ${hitCount} violations found.`);
  process.exit(1);
} else {
  console.log('Placeholder scan PASSED: 0 violations found.');
}

