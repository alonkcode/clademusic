// Renders the mark SVGs to PNGs so the artwork can be eyeballed and packed
// into an .ico. Uses the Playwright chromium the test suite already installs.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const jobs = JSON.parse(process.argv[2]);
const browser = await chromium.launch();
for (const { svg, out, size, bg } of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const data = readFileSync(svg, 'utf8');
  await page.setContent(
    `<style>html,body{margin:0;background:${bg ?? 'transparent'}}svg{width:${size}px;height:${size}px;display:block}</style>${data}`,
  );
  writeFileSync(out, await page.screenshot({ omitBackground: !bg }));
  await page.close();
  console.log('rendered', out, size);
}
await browser.close();
