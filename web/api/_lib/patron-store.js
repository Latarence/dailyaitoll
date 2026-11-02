// Patron storage in KV.
//
// Each completed checkout session is ONE field of the `patrons:v2` hash, written with HSETNX. That single
// command is both the per-session dedupe and the record, so there is no window between "claimed" and
// "listed", and two different sessions can never overwrite each other (the old design read the whole
// `patrons:v1` object, prepended, and wrote it all back: last writer won).
// `patrons:v1` (the old whole-object listing) is still read so existing patrons keep showing.
const PATRONS_V2_KEY = 'patrons:v2';
const PATRONS_V1_KEY = 'patrons:v1';
const TIERS = ['founding', 'sustainer', 'supporter'];
const MAX_PER_TIER = 500;

function parseRecord(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

// Returns true when this session was newly recorded, false for a duplicate session or an unknown tier.
async function addPatron(kv, { tier, name, url, description, stripeSessionId }) {
  if (!TIERS.includes(tier)) return false;
  const record = { tier, name, url: url || '', created_at: Date.now() };
  if (tier === 'founding') record.description = description || '';
  const added = await kv.hsetnx(PATRONS_V2_KEY, stripeSessionId, JSON.stringify(record));
  return !!added;
}

// Public listing shape: { founding: [{name,url[,description]}], sustainer: [...], supporter: [...] },
// newest first, legacy v1 entries after the v2 ones, at most MAX_PER_TIER per tier.
async function listPatrons(kv) {
  const [legacy, hash] = await Promise.all([kv.get(PATRONS_V1_KEY), kv.hgetall(PATRONS_V2_KEY)]);
  const records = Object.values(hash || {}).map(parseRecord).filter(Boolean);
  const out = {};
  for (const tier of TIERS) {
    const fresh = records
      .filter((r) => r.tier === tier)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .map((r) => {
        const e = { name: r.name, url: r.url || '' };
        if (tier === 'founding') e.description = r.description || '';
        return e;
      });
    out[tier] = [...fresh, ...((legacy && legacy[tier]) || [])].slice(0, MAX_PER_TIER);
  }
  return out;
}

module.exports = { addPatron, listPatrons, PATRONS_V2_KEY, PATRONS_V1_KEY };
