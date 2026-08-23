const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public', 'favicon.svg');
const outputs = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
  ['favicon-192x192.png', 192],
  ['favicon-512x512.png', 512],
];

async function main() {
  if (!fs.existsSync(source)) throw new Error(`Missing favicon source: ${source}`);
  for (const [name, size] of outputs) {
    await sharp(source)
      .resize(size, size)
      .png()
      .toFile(path.join(root, 'public', name));
  }
  fs.writeFileSync(path.join(root, 'public', 'site.webmanifest'), JSON.stringify({
    name: 'Coden',
    short_name: 'Coden',
    description: 'AI app builder with database, preview, deploy and SEO-ready output.',
    icons: [
      { src: '/favicon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/favicon-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
