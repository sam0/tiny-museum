// Downloads each pooled artwork's image into docs/img/<id>.jpg (public domain / CC0), so the site
// doesn't depend on hotlinking museum image servers. Only fetches what tools/pool.json needs.
// Images are shrunk to 720px on the long edge (macOS sips) to keep the site light.
// Usage: node tools/build-quiz.cjs --no-notes && node tools/fetch-images.cjs
const fs = require('fs');
const { execFileSync } = require('child_process');
const { loadRaw, sleep } = require('./lib.cjs');

const want = new Set(JSON.parse(fs.readFileSync('tools/pool.json', 'utf8')));
const raw = loadRaw().filter((o) => want.has(o.objectID));
fs.mkdirSync('docs/img', { recursive: true });
(async () => {
  let ok = 0, fail = 0;
  for (const o of raw) {
    const dest = `docs/img/${o.objectID}.jpg`;
    if (fs.existsSync(dest)) { ok++; continue; }
    const url = o.primaryImageSmall.replace('/full/843,/', '/full/720,/');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)), headers: { 'User-Agent': 'Mozilla/5.0 (tiny-museum-quiz; portfolio project)', 'AIC-User-Agent': 'tiny-museum-quiz (portfolio project)' } });
      if (!r.ok) throw new Error(r.status);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      execFileSync('sips', ['-Z', '720', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', dest, '--out', dest], { stdio: 'ignore' });
      ok++;
    } catch (e) { fail++; fs.rmSync(dest, { force: true }); console.error(`failed ${o.objectID}: ${e.message}`); }
    await sleep(250);
  }
  console.log(`images: ${ok} saved, ${fail} failed`);
})();
