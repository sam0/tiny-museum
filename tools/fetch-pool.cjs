// Pulls the Met's highlighted, public-domain artworks into tools/raw.json.
// Usage: node tools/fetch-pool.cjs
const fs = require('fs');
const API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'tiny-museum-quiz/1.0 (portfolio project; one-time snapshot)' } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    if (i < tries - 1) await sleep(5000 * (i + 1));
  }
  return null;
}

(async () => {
  const { objectIDs: all } = await getJSON(`${API}/search?isHighlight=true&hasImages=true&q=*`);
  const MAX = Number(process.env.MAX || 650);
  const out = fs.existsSync('tools/raw.json') ? JSON.parse(fs.readFileSync('tools/raw.json', 'utf8')) : [];
  const have = new Set(out.map((o) => o.objectID));
  // Spread the sample across the whole list so every department is represented
  const step = Math.max(1, Math.floor(all.length / MAX));
  const objectIDs = all.filter((_, i) => i % step === 0).filter((id) => !have.has(id));
  let done = 0;
  const queue = [...objectIDs];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const o = await getJSON(`${API}/objects/${id}`);
      done++;
      if (o && o.isPublicDomain && o.primaryImageSmall) out.push(o);
      if (done % 50 === 0) { console.log(`${done}/${objectIDs.length} fetched, ${out.length} kept`); fs.writeFileSync('tools/raw.json', JSON.stringify(out)); }
      await sleep(Number(process.env.GAP || 700));
    }
  }
  await Promise.all(Array.from({ length: 1 }, worker));
  fs.writeFileSync('tools/raw.json', JSON.stringify(out));
  console.log(`done: ${out.length} public-domain highlights with images`);
})();
