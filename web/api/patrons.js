const fs = require('fs');
const path = require('path');
let kv;
try {
  ({ kv } = require('@vercel/kv'));
} catch {
  kv = null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.FEATURE_USE_KV_PATRONS === 'true') {
      if (!kv) throw new Error('KV not available');
      const patrons =
        (await kv.get('patrons:v1')) || { founding: [], sustainer: [], supporter: [] };
      return res.status(200).json({ patrons });
    }

    // Fallback: read the static JSON file committed to the repo.
    const p = path.join(__dirname, '..', 'data', 'patrons.json');
    const patrons = JSON.parse(fs.readFileSync(p, 'utf8')).patrons;

    return res.status(200).json({ patrons });
  } catch (err) {
    console.error('patrons api error:', err);
    return res.status(500).json({ error: 'Failed to load patrons' });
  }
};
