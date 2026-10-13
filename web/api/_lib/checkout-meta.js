// Shared by both create-checkout functions (L-DAT-03 terms consent, L-DAT-04 campaign attribution).
//
// Terms consent: the buyer ticks a box on /data or /patrons/checkout that links the Terms, the
// Data License (data only) and the Refund Policy. The function refuses to create a session without
// it and records the server time of the acceptance in the session metadata (ISO 8601 UTC), so the
// record lives on the Checkout Session / payment in Stripe.
//
// Attribution: utm_* and ref captured first-party on the landing page (sessionStorage, see
// /js/consent.js) are sent with the request. Only short [A-Za-z0-9_-] values are kept; they go into
// the session metadata and a short client_reference_id. Nothing is added when there are no tags.

const TERMS_VERSION = '2026-10-13';
const FIELDS = [
  ['utm_source', 's'],
  ['utm_medium', 'm'],
  ['utm_campaign', 'c'],
  ['utm_term', 't'],
  ['utm_content', 'n'],
  ['ref', 'r'],
];

function clean(v, n, re) {
  return String(v == null ? '' : v).replace(re, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, n);
}

function termsAccepted(body) {
  return !!body && body.terms_accepted === true;
}

function termsMetadata(now) {
  return {
    terms_accepted_at: (now || new Date()).toISOString(),
    terms_version: TERMS_VERSION,
  };
}

// Returns { metadata, clientReferenceId } — both empty when there is nothing to record.
function attribution(input) {
  const metadata = {};
  let ref = 'dat';
  let any = false;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, short] of FIELDS) {
      const v = clean(input[key], 150, /[^A-Za-z0-9_-]+/g);
      if (!v) continue;
      metadata[key] = v;
      ref += '_' + short + '-' + clean(v, 40, /[^A-Za-z0-9-]+/g);
      any = true;
    }
  }
  return {
    metadata,
    clientReferenceId: any ? clean(ref.slice(0, 200), 200, /[^A-Za-z0-9_-]+/g) : undefined,
  };
}

const TERMS_REQUIRED_ERROR = 'Please accept the Terms and the Refund Policy to continue.';

module.exports = { termsAccepted, termsMetadata, attribution, TERMS_REQUIRED_ERROR, TERMS_VERSION };
