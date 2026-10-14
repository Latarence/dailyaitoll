// Stripe charge.dispute.* recording (R-dailyaitoll-2).
// Each dispute is one field of the KV hash `disputes:v1` (field = dispute id, value = JSON record),
// so the operator can read every dispute from the Vercel KV console and /api/health reports how
// many are open. No email is sent from here (email is gated separately).
// When KV is not configured the dispute is still logged as a DISPUTE_ALERT line in the function logs.

const DISPUTE_EVENTS = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);
const DISPUTES_KEY = 'disputes:v1';
// Stripe statuses that still need the operator (evidence due or under review).
const OPEN_STATUSES = new Set(['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review']);
const HISTORY_MAX = 20;

function isDisputeEvent(type) {
  return DISPUTE_EVENTS.has(type);
}

function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function isoFromUnix(sec) {
  return typeof sec === 'number' && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}

function parseRecord(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function idOf(v) {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id || null;
}

// Build the next stored record from the previous one and this event.
// Returns null when the event was already applied (Stripe retries deliver the same event id).
function mergeRecord(prev, event, nowIso) {
  const d = event.data.object;
  const eventCreated = typeof event.created === 'number' ? event.created : 0;
  const history = (prev && Array.isArray(prev.history)) ? prev.history : [];
  if (event.id && history.some((h) => h.event_id === event.id)) return null;

  const entry = { event_id: event.id || null, type: event.type, status: d.status || null, at: isoFromUnix(eventCreated) };
  // Events can arrive out of order: only a newer (or equal-time) event may overwrite current fields.
  const isNewer = !prev || eventCreated >= (prev.last_event_created || 0);
  const base = isNewer ? {
    id: d.id,
    amount: typeof d.amount === 'number' ? d.amount : null,
    currency: d.currency || null,
    reason: d.reason || null,
    status: d.status || null,
    charge: idOf(d.charge),
    payment_intent: idOf(d.payment_intent),
    created: isoFromUnix(d.created),
    evidence_due_by: isoFromUnix(d.evidence_details && d.evidence_details.due_by),
    livemode: !!d.livemode,
    last_event_type: event.type,
    last_event_created: eventCreated,
  } : { ...prev };

  return {
    ...base,
    open: OPEN_STATUSES.has(base.status),
    first_seen_at: (prev && prev.first_seen_at) || nowIso,
    updated_at: nowIso,
    history: [...history, entry].slice(-HISTORY_MAX),
  };
}

// Records the dispute. Returns {recorded: true|false, duplicate?: true, record}.
// Throws only when KV is configured but the write fails, so Stripe retries the event.
async function recordDispute(event, { kv, now = () => new Date() } = {}) {
  const d = event.data && event.data.object;
  if (!d || !d.id) throw new Error('Dispute event without object id');
  const nowIso = now().toISOString();

  if (!kv || !kvConfigured()) {
    const record = mergeRecord(null, event, nowIso);
    console.error('DISPUTE_ALERT (KV not configured, not stored) ' + JSON.stringify({
      id: record.id, type: event.type, status: record.status, amount: record.amount,
      currency: record.currency, reason: record.reason, charge: record.charge, created: record.created,
    }));
    return { recorded: false, record };
  }

  const prev = parseRecord(await kv.hget(DISPUTES_KEY, d.id));
  const record = mergeRecord(prev, event, nowIso);
  if (!record) return { recorded: true, duplicate: true, record: prev };
  await kv.hset(DISPUTES_KEY, { [d.id]: JSON.stringify(record) });
  console.warn(`DISPUTE_ALERT ${event.type} ${record.id} status=${record.status} amount=${record.amount} ${record.currency || ''} reason=${record.reason}`);
  return { recorded: true, record };
}

// Summary for /api/health: counts only, no customer or charge detail.
async function disputeSummary(kv) {
  const all = (await kv.hgetall(DISPUTES_KEY)) || {};
  const records = Object.values(all).map(parseRecord).filter(Boolean);
  const open = records.filter((r) => OPEN_STATUSES.has(r.status));
  const latest = records.map((r) => r.updated_at).filter(Boolean).sort().pop() || null;
  return { total: records.length, open: open.length, last_updated_at: latest };
}

module.exports = { isDisputeEvent, recordDispute, disputeSummary, mergeRecord, kvConfigured, DISPUTES_KEY, OPEN_STATUSES };
