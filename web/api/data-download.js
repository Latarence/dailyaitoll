const { sql } = require('@vercel/postgres');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS data_licenses (
      id BIGSERIAL PRIMARY KEY,
      tier TEXT NOT NULL CHECK (tier IN ('journalist', 'commercial')),
      email TEXT NOT NULL DEFAULT '',
      stripe_session_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // The dataset itself lives in Postgres as well.
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_date DATE,
      collected_date DATE,
      headline TEXT,
      excerpt TEXT,
      source_name TEXT,
      source_url TEXT,
      causality TEXT,
      confidence DOUBLE PRECISION,
      jobs INTEGER,
      created_at TIMESTAMPTZ
    );
  `;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

async function hasLicense(sessionId) {
  const { rows } = await sql`
    SELECT tier, email
    FROM data_licenses
    WHERE stripe_session_id = ${sessionId}
    LIMIT 1;
  `;
  return rows[0] || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = req.query?.session_id;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    await ensureSchema();

    // Fast path: already recorded via webhook.
    let license = await hasLicense(sessionId);

    // Slow path: verify with Stripe (covers webhook delays).
    if (!license) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session || session.payment_status !== 'paid') {
        return res.status(403).json({ error: 'Payment not verified' });
      }

      const kind = session.metadata?.kind;
      const tier = session.metadata?.tier;
      if (kind !== 'data_license' || !tier) {
        return res.status(403).json({ error: 'Not a data license purchase' });
      }

      const email = session.customer_details?.email || session.customer_email || '';
      await sql`
        INSERT INTO data_licenses (tier, email, stripe_session_id)
        VALUES (${tier}, ${email}, ${sessionId})
        ON CONFLICT (stripe_session_id)
        DO NOTHING;
      `;

      license = { tier, email };
    }

    // Stream CSV generated from Postgres events table.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="daily-ai-toll-events.csv"');

    const header = [
      'id',
      'event_date',
      'collected_date',
      'company',
      'jobs',
      'headline',
      'excerpt',
      'source_name',
      'source_url',
      'causality',
      'confidence',
      'created_at',
    ].join(',');
    res.write(header + '\n');

    const { rows } = await sql`
      SELECT id,
             event_date,
             collected_date,
             headline,
             excerpt,
             source_name,
             source_url,
             causality,
             confidence,
             jobs,
             created_at
      FROM events
      ORDER BY created_at DESC NULLS LAST, event_date DESC NULLS LAST, id DESC;
    `;

    for (const r of rows) {
      const headline = r.headline || '';
      const company = headline ? headline.split(' ')[0] : '';
      const line = [
        csvEscape(r.id),
        csvEscape(r.event_date || ''),
        csvEscape(r.collected_date || ''),
        csvEscape(company),
        csvEscape(r.jobs ?? 0),
        csvEscape(headline),
        csvEscape(r.excerpt || ''),
        csvEscape(r.source_name || ''),
        csvEscape(r.source_url || ''),
        csvEscape(r.causality || ''),
        csvEscape(r.confidence ?? ''),
        csvEscape(r.created_at || ''),
      ].join(',');
      res.write(line + '\n');
    }

    return res.end();
  } catch (err) {
    console.error('data download error:', err);
    return res.status(500).json({ error: 'Failed to verify download' });
  }
};
