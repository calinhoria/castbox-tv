// Generates the component/prop reference tables in PRESET_SPEC.md from the
// schema, so the spec can never drift from the code. Writes the block between
// the BEGIN/END markers. Run: node tools/gen-spec-tables.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_TYPES, SCHEMAS, SCHEMA_VERSION } from '../js/presets.js';
import { PALETTES, PALETTE_ROLES, DYNAMIC_ROLE, FROM_COVER } from '../js/palettes.js';

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, '..', 'PRESET_SPEC.md');

const fmt = (p) => {
  if (p.kind === 'range') {
    const d = p.default === undefined ? '—' : p.default + (p.pct ? ' (fraction of box)' : '');
    const step = p.step !== undefined && p.step < 1 ? ', step ' + p.step : '';
    return p.min + '..' + p.max + step + ' — default ' + d;
  }
  if (p.kind === 'bool') return 'default ' + (p.default ? 'true' : 'false');
  if (p.kind === 'select') return p.options.map((o) => o.v + ' = ' + o.t).join(', ') +
    (p.default !== undefined ? ' — default ' + p.default : '');
  if (p.kind === 'color') return 'colour; default ' + (p.default || '—');
  if (p.kind === 'image') return 'image id or {cover}' + (p.default ? ' — default ' + p.default : '');
  return p.kind;
};

const lines = [];
lines.push('### Components');
lines.push('');
lines.push('Schema version `' + SCHEMA_VERSION + '`. Every component takes the same');
lines.push('geometry props: `x`, `y`, `w`, `h` (fractions of the 1280x720 surface;');
lines.push('`w`/`h` are the box size, `x`/`y` its top-left corner) and `opacity`.');
lines.push('');
lines.push('Component list is index order: index 0 is drawn first (bottom), the last');
lines.push('index is on top. `hidden: true` keeps an index but draws nothing.');
lines.push('');

for (const t of COMPONENT_TYPES) {
  const s = SCHEMAS[t.type];
  if (!s) continue;
  lines.push('#### `' + t.type + '` — ' + t.hint);
  lines.push('');
  const groups = [];
  for (const p of s) {
    let g = groups.find((x) => x.name === p.group);
    if (!g) { g = { name: p.group, props: [] }; groups.push(g); }
    g.props.push(p);
  }
  for (const g of groups) {
    lines.push('*' + g.name + '*');
    lines.push('');
    lines.push('| prop | type | values |');
    lines.push('|---|---|---|');
    for (const p of g.props) {
      const hint = p.hint ? '<br><sub>' + p.hint + '</sub>' : '';
      lines.push('| `' + p.key + '` | ' + p.kind + ' | ' + fmt(p) + hint + ' |');
    }
    lines.push('');
  }
}

lines.push('### Palettes');
lines.push('');
lines.push('A preset names one of these, or **' + FROM_COVER + '**:');
lines.push('');
lines.push('| palette | ' + PALETTE_ROLES.join(' | ') + ' |');
lines.push('|---|' + PALETTE_ROLES.map(() => '---').join('|') + '|');
for (const p of PALETTES) {
  lines.push('| ' + p.name + ' | ' + PALETTE_ROLES.map((r) => '`' + p.roles[r] + '`').join(' | ') + ' |');
}
lines.push('');
lines.push('`' + DYNAMIC_ROLE + '` is a seventh role, published for **every** preset and');
lines.push('never stored in one: it is the dominant cover-art colour pulled down to');
lines.push('~30% luminance. Bind a colour prop to `{dynamic}` for an artwork-tinted');
lines.push('backdrop that still keeps fixed brand colours for text and accents.');
lines.push('');

const spec = readFileSync(specPath, 'utf8');
const start = '<!-- BEGIN GENERATED TABLES -->';
const end = '<!-- END GENERATED TABLES -->';
const a = spec.indexOf(start);
const b = spec.indexOf(end);
if (a < 0 || b < 0) {
  console.error('markers missing from PRESET_SPEC.md');
  process.exit(1);
}
writeFileSync(specPath, spec.slice(0, a + start.length) + '\n\n' +
  lines.join('\n') + '\n' + spec.slice(b));
console.log('PRESET_SPEC.md tables refreshed (' + COMPONENT_TYPES.length + ' components)');