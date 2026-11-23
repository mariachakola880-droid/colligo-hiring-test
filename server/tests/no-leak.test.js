// INC-0304: private team notes must never reach a customer. The customer code path
// is kept structurally separate: it must not mention internal notes at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CUSTOMER_PATH = [
  'src/routes/customer.js',
  'src/services/customerService.js',
  'src/services/ticketCore.js',
  'src/services/timeline.js',
];
const FORBIDDEN = [/internalNote/i, /internal_notes/i, /\bnotes\b/i];

for (const file of CUSTOMER_PATH) {
  test(`${file} never references internal notes`, () => {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // ignore comments
    for (const pattern of FORBIDDEN) assert.doesNotMatch(code, pattern, `${file} matches ${pattern}`);
  });
}
