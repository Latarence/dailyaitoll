const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml, safeUrl, sanitizePatron, sanitizePatrons } = require('./patron-safe');

test('escapeHtml neutralises markup', () => {
  assert.strictEqual(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(escapeHtml('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
});

test('safeUrl allows only http(s)', () => {
  assert.strictEqual(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.strictEqual(safeUrl('javascript:alert(1)'), '');
  assert.strictEqual(safeUrl('data:text/html,<script>'), '');
  assert.strictEqual(safeUrl('not a url'), '');
  assert.strictEqual(safeUrl(''), '');
});

test('sanitizePatron truncates and strips bad links', () => {
  const p = sanitizePatron({ name: 'x'.repeat(500), url: 'javascript:1', description: 'd'.repeat(5000) });
  assert.strictEqual(p.name.length, 80);
  assert.strictEqual(p.url, '');
  assert.strictEqual(p.description.length, 1500);
});

test('sanitizePatrons tolerates missing tiers', () => {
  const out = sanitizePatrons({ supporter: [{ name: 'A', url: 'https://a.example' }] });
  assert.deepStrictEqual(Object.keys(out), ['founding', 'sustainer', 'supporter']);
  assert.strictEqual(out.supporter[0].url, 'https://a.example/');
});
