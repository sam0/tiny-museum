// Pulls the Met's highlighted, public-domain artworks into tools/raw.json, a few departments at a time.
// DEPTS is "departmentId:count,..." (6 Asian Art, 14 Islamic Art, 11 European Paintings).
// The Met's bot protection blocks fast bulk fetching, so this runs one request at a time with gaps.
// Usage: node tools/fetch-pool.cjs   (DEPTS=6:60,14:30,11:50 GAP=700)
const fs = require('fs');
const { getJSON, sleep } = require('./lib.cjs');
const API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const H = { headers: { 'User-Agent': 'Mozilla/5.0 (tiny-museum-quiz; portfolio project)' } };

(async () => {
  const depts = (process.env.DEPTS || '6:60,14:30,11:50').split(',').map((s) => s.split(':').map(Number));
  const out = fs.existsSync('tools/raw.json') ? JSON.parse(fs.readFileSync('tools/raw.json', 'utf8')) : [];
  const have = new Set(out.map((o) => o.objectID));
  for (const [dept, want] of depts) {
    const all = (await getJSON(`${API}/search?isHighlight=true&hasImages=true&departmentId=${dept}&q=*`, H))?.objectIDs || [];
    // Spread the sample across the whole list, and overshoot a little since some aren't public domain
    const step = Math.max(1, Math.floor(all.length / (want * 1.3)));
    const ids = all.filter((_, i) => i % step === 0).filter((id) => !have.has(id));
    let kept = 0;
    for (const id of ids) {
      if (kept >= want) break;
      const o = await getJSON(`${API}/objects/${id}`, H);
      if (o && o.isPublicDomain && o.primaryImageSmall) { out.push({ ...o, museum: 'The Met', famous: true }); kept++; }
      await sleep(Number(process.env.GAP || 700));
    }
    console.log(`department ${dept}: ${all.length} highlights, kept ${kept}`);
    fs.writeFileSync('tools/raw.json', JSON.stringify(out));
  }
  console.log(`done: ${out.length} public-domain highlights with images`);
})();
