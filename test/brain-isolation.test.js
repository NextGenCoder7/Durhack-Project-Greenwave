import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAIN = fileURLToPath(new URL('../src/brain/', import.meta.url));
const files = readdirSync(BRAIN).filter(f => f.endsWith('.js'));

test('brain has source files', () => assert.ok(files.length >= 2));

for (const f of files) {
  const src = readFileSync(join(BRAIN, f), 'utf8');
  test(`${f}: imports only from inside src/brain`, () => {
    for (const m of src.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('./'), `${f} imports ${m[1]}`);
    }
    assert.doesNotMatch(src, /import\s*\(/, 'no dynamic imports');
  });
  test(`${f}: no randomness, clocks, timers or host globals`, () => {
    assert.doesNotMatch(src, /Math\.random|\bDate\b|setTimeout|setInterval|\bself\b|\bwindow\b|\bdocument\b|performance|globalThis|postMessage/);
  });
}
