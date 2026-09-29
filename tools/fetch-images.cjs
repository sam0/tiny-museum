// Downloads each quiz artwork image into docs/img/<id>.jpg (public domain / CC0), so the site
// doesn't depend on hotlinking the museum's image server.
// Usage: node tools/fetch-images.cjs   (then: sips -Z 720 -s formatOptions 72 docs/img/*.jpg)
const fs = require('fs');
const raw = ['tools/raw.json', 'tools/raw-aic.json'].filter((f) => fs.existsSync(f)).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
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
      ok++;
    } catch (e) { fail++; console.error(`failed ${o.objectID}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`images: ${ok} saved, ${fail} failed`);
})();
