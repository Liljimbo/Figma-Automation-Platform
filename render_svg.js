const { chromium } = require('C:/Users/a1808/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright');
const fs = require('fs');

(async () => {
  const htmlPath = 'C:/Users/a1808/Desktop/Figma-Forge/emile_render.html';
  const pngPath = 'C:/Users/a1808/Desktop/Figma-Forge/emile_brand_full.png';

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 3000 } });

  await page.goto('file:///' + htmlPath);
  await page.waitForTimeout(2000);

  const svgBox = await page.locator('svg').boundingBox();
  console.log('SVG box:', JSON.stringify(svgBox));

  await page.locator('svg').screenshot({ path: pngPath, scale: 'device' });

  await browser.close();

  const stats = fs.statSync(pngPath);
  console.log('PNG saved:', pngPath);
  console.log('Size:', (stats.size / 1024).toFixed(1), 'KB');
  console.log('Done!');
})().catch(e => { console.error(e); process.exit(1); });
