#!/usr/bin/env node
// Diffs two style capture files (produced by extract-styles.js) into a
// Markdown delta report grouped by category, applying tolerance rules so
// subpixel rounding and anti-aliasing don't show up as false deltas.
//
// Usage: node compare-styles.js <source.json> <target.json> [report.md]

const fs = require('fs');

const CATEGORIES = {
  Typography: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform'],
  Color: ['color', 'backgroundColor', 'borderColor'],
  Spacing: [
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
  ],
  'Radius & Sizing': ['borderRadius', 'maxWidth', 'width'],
  'Border & Shadow': ['borderWidth', 'borderStyle', 'boxShadow'],
};

const PX_PROPS = new Set([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
  'borderRadius', 'maxWidth', 'width', 'borderWidth', 'fontSize', 'letterSpacing', 'lineHeight',
]);

const PX_TOLERANCE = 1;
const COLOR_CHANNEL_TOLERANCE = 6;

function parsePx(value) {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function parseRgb(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value || '');
  if (!match) return null;
  return match[1].split(',').map((part) => parseFloat(part.trim()));
}

function colorsClose(a, b) {
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  if (!ca || !cb || ca.length < 3 || cb.length < 3) return a === b;
  return ca.slice(0, 3).every((v, i) => Math.abs(v - cb[i]) <= COLOR_CHANNEL_TOLERANCE);
}

function valuesEqual(prop, a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (prop.toLowerCase().includes('color')) return colorsClose(a, b);
  if (PX_PROPS.has(prop)) {
    const na = parsePx(a);
    const nb = parsePx(b);
    if (na != null && nb != null) return Math.abs(na - nb) <= PX_TOLERANCE;
  }
  return false;
}

function main() {
  const [, , sourcePath, targetPath, outPath] = process.argv;
  if (!sourcePath || !targetPath) {
    console.error('Usage: node compare-styles.js <source.json> <target.json> [report.md]');
    process.exit(1);
  }

  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

  const lines = ['# Style Delta Report', ''];
  let totalDeltas = 0;

  const selectors = Array.from(new Set([...Object.keys(source), ...Object.keys(target)])).sort();

  for (const sel of selectors) {
    const sourceEls = source[sel] || [];
    const targetEls = target[sel] || [];
    const count = Math.max(sourceEls.length, targetEls.length);
    if (!count) continue;

    const rows = [];

    for (let i = 0; i < count; i += 1) {
      const sourceEl = sourceEls[i];
      const targetEl = targetEls[i];

      if (!sourceEl || !targetEl) {
        const missingSide = sourceEl ? 'target' : 'source';
        rows.push(`| _(element #${i} missing on ${missingSide})_ | — | — | — |`);
        totalDeltas += 1;
        continue;
      }

      for (const [category, props] of Object.entries(CATEGORIES)) {
        for (const prop of props) {
          const a = sourceEl.styles[prop];
          const b = targetEl.styles[prop];
          if (a === undefined && b === undefined) continue;
          if (!valuesEqual(prop, a, b)) {
            rows.push(`| ${category} | \`${prop}\` (#${i}) | \`${a}\` | \`${b}\` |`);
            totalDeltas += 1;
          }
        }
      }
    }

    if (rows.length) {
      lines.push(
        `## \`${sel}\``,
        '',
        '| Category | Property | Source | Target |',
        '|---|---|---|---|',
        ...rows,
        '',
      );
    }
  }

  if (!totalDeltas) {
    lines.push('No deltas found within tolerance.');
  }

  const report = lines.join('\n');

  if (outPath) {
    fs.writeFileSync(outPath, report);
    console.log(`Wrote ${outPath} (${totalDeltas} deltas)`);
  } else {
    console.log(report);
  }
}

main();
