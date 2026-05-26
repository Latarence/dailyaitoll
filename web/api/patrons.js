const { sql } = require('@vercel/postgres');

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS patrons (
      id BIGSERIAL PRIMARY KEY,
      tier TEXT NOT NULL CHECK (tier IN ('supporter', 'sustainer', 'founding')),
      name TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      stripe_session_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureSchema();

    const { rows } = await sql`
      SELECT tier, name, url, description
      FROM patrons
      ORDER BY created_at DESC, id DESC
      LIMIT 250;
    `;

    const patrons = { founding: [], sustainer: [], supporter: [] };
    for (const r of rows) {
      patrons[r.tier]?.push({
        name: r.name,
        url: r.url || '',
        description: r.description || '',
      });
    }

    return res.status(200).json({ patrons });
  } catch (err) {
    console.error('patrons api error:', err);
    return res.status(500).json({ error: 'Failed to load patrons' });
  }
};
