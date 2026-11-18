// Patron names, links and descriptions are typed by the buyer at checkout and rendered on the public
// /patrons page. Keep them as plain text: the page must escape them, and only http(s) links are allowed.
const MAX_NAME = 80;
const MAX_URL = 300;
const MAX_DESC = 1500;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(u) {
  const s = String(u == null ? '' : u).trim().slice(0, MAX_URL);
  if (!s) return '';
  try {
    const parsed = new URL(s);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function sanitizePatron(p) {
  const src = p || {};
  const out = { name: String(src.name == null ? '' : src.name).slice(0, MAX_NAME), url: safeUrl(src.url) };
  if (src.description != null) out.description = String(src.description).slice(0, MAX_DESC);
  return out;
}

function sanitizePatrons(patrons) {
  const out = { founding: [], sustainer: [], supporter: [] };
  for (const tier of Object.keys(out)) {
    out[tier] = ((patrons && patrons[tier]) || []).map(sanitizePatron);
  }
  return out;
}

module.exports = { escapeHtml, safeUrl, sanitizePatron, sanitizePatrons };
