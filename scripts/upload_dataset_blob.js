const fs = require('fs');
const path = require('path');
const { put } = require('@vercel/blob');

async function main() {
  const root = path.resolve(__dirname, '..');
  const csvPath = path.join(root, 'web', 'api', '_data', 'events.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing CSV at ${csvPath}`);
  }

  const body = fs.readFileSync(csvPath);

  // Stable pathname so /api/data-download (head + server-side fetch) and /api/health can find it.
  const pathname = 'datasets/events.csv';

  // @vercel/blob 1.x only accepts access: 'public' ('private' throws). The URL is never sent to clients
  // (data-download streams it after verifying payment) and is never logged: this repo's Actions logs are public.
  await put(pathname, body, {
    access: 'public',
    contentType: 'text/csv',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  // Don't print credentials or the blob URL.
  console.log(`Uploaded ${pathname} (${body.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
