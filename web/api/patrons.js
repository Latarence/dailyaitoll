const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const patrons =
      (await kv.get('patrons:v1')) || { founding: [], sustainer: [], supporter: [] };

    return res.status(200).json({ patrons });
  } catch (err) {
    console.error('patrons api error:', err);
    return res.status(500).json({ error: 'Failed to load patrons' });
  }
};
