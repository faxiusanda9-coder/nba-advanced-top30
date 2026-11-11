import {appendFile, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

let needed = true;
if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (event.workflow_run.head_branch !== 'main' || event.workflow_run.event === 'pull_request') {
    needed = false;
  } else {
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'});
    if (revision.status !== 0) throw new Error('Cannot identify current source');
    const headers = {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
    const endpoint = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/deployments`;
    const response = await fetch(`${endpoint}?environment=github-pages&sha=${revision.stdout.trim()}&per_page=10`,
      {headers, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Deployment lookup returned ${response.status}`);
    for (const deployment of await response.json()) {
      const status = await fetch(`${endpoint}/${deployment.id}/statuses?per_page=1`,
        {headers, signal: AbortSignal.timeout(15000)});
      if (!status.ok) throw new Error(`Deployment status returned ${status.status}`);
      if ((await status.json())[0]?.state === 'success') {needed = false; break;}
    }
  }
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
console.log(needed ? 'Source needs publication.' : 'Current source is already published; no rebuild.');
