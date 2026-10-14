const fs = require('fs');
const path = require('path');
let kv;
try {
  ({ kv } = require('@vercel/kv'));
} catch {
  kv = null;
}
const { kvConfigured } = require('./_lib/disputes');

function readStaticPatrons() {
  const p = path.join(__dirname, '..', 'data', 'patrons.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).patrons;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.FEATURE_USE_KV_PATRONS === 'true') {
      if (kv && kvConfigured()) {
        try {
          const patrons =
            (await kv.get('patrons:v1')) || { founding: [], sustainer: [], supporter: [] };
          return res.status(200).json({ patrons });
        } catch (err) {
          console.error('patrons KV read failed, serving static list:', err && err.message);
        }
      } else {
        console.error('patrons: FEATURE_USE_KV_PATRONS is on but KV is not configured; serving static list');
      }
    }

    // Fallback: read the static JSON file committed to the repo.
    return res.status(200).json({ patrons: readStaticPatrons() });
  } catch (err) {
    console.error('patrons api error:', err);
    return res.status(500).json({ error: 'Failed to load patrons' });
  }
};
