const fs = require('fs');
const path = require('path');
const { put } = require('@vercel/blob');

async function main() {
  const root = path.resolve(__dirname, '..');
  const csvPath = path.join(root, 'web', 'data', 'events.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing CSV at ${csvPath}`);
  }

  const body = fs.readFileSync(csvPath);

  // Stable pathname so /api/data-download can fetch by pathname.
  const pathname = 'datasets/events.csv';

  const blob = await put(pathname, body, {
    access: 'private',
    contentType: 'text/csv',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  // Don't print credentials; printing the blob URL is fine.
  console.log(`Uploaded ${pathname} -> ${blob.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
