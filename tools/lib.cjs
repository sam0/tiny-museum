// Shared helpers for the fetchers and the build.
const fs = require('fs');
const path = require('path');

// Every fetcher writes tools/raw*.json in the same record shape (see fetch-aic.cjs)
function loadRaw() {
  return fs.readdirSync(__dirname)
    .filter((f) => /^raw.*\.json$/.test(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, { tries = 4, headers = {} } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'tiny-museum-quiz/1.0 (portfolio project; one-time snapshot)', ...headers }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    if (i < tries - 1) await sleep(3000 * (i + 1));
  }
  return null;
}

module.exports = { loadRaw, sleep, getJSON };
