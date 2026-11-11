import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'team-logos');
await mkdir(directory, {recursive:true});
for (let id = 1610612737; id <= 1610612766; id++) {
  const url = `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`;
  const response = await fetch(url, {signal:AbortSignal.timeout(12000), headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'}});
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const svg = (await response.text()).split('\n').map(line => line.trimEnd()).join('\n');
  if (!/<svg\b/.test(svg) || svg.length < 500) throw new Error(`${id}: invalid SVG`);
  await writeFile(path.join(directory, `${id}.svg`), svg);
}
console.log('Saved 30 NBA CDN team logo SVGs.');
