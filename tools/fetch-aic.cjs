// Pulls the Art Institute of Chicago's most-viewed ("boosted") public-domain artworks into
// tools/raw-aic.json, in the same shape as the Met records in tools/raw.json.
// Usage: node tools/fetch-aic.cjs
const fs = require('fs');
const FIELDS = ['id', 'title', 'artist_title', 'artist_display', 'date_display', 'date_start', 'date_end', 'place_of_origin',
  'department_title', 'medium_display', 'classification_title', 'image_id'];

(async () => {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch('https://api.artic.edu/api/v1/artworks/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'AIC-User-Agent': 'tiny-museum-quiz (portfolio project)' },
      body: JSON.stringify({
        query: { bool: { must: [{ term: { is_public_domain: true } }, { term: { is_boosted: true } }, { exists: { field: 'image_id' } }] } },
        fields: FIELDS, limit: 100, page
      })
    });
    const j = await res.json();
    for (const d of j.data) {
      out.push({
        objectID: `aic-${d.id}`,
        isPublicDomain: true,
        title: d.title,
        artistDisplayName: d.artist_title || '',
        artistDisplayBio: (d.artist_display || '').split('\n').slice(1).join(' '),
        objectDate: d.date_display || '',
        objectBeginDate: d.date_start,
        objectEndDate: d.date_end ?? d.date_start,
        culture: '',
        country: d.place_of_origin || '',
        department: d.department_title || '',
        medium: d.medium_display || '',
        classification: d.classification_title || '',
        primaryImageSmall: `https://www.artic.edu/iiif/2/${d.image_id}/full/843,/0/default.jpg`,
        objectURL: `https://www.artic.edu/artworks/${d.id}`,
        museum: 'Art Institute of Chicago'
      });
    }
    if (page >= j.pagination.total_pages) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fs.writeFileSync('tools/raw-aic.json', JSON.stringify(out));
  console.log(`saved ${out.length} artworks`);
})();
