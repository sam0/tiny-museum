// Pulls a hand-picked list of very famous open-access works ("greatest hits") into tools/raw-hits.json,
// so the quiz has the pieces people actually recognize. Each entry is searched by title + artist,
// and only kept if the museum marks it public domain / CC0.
// Usage: node tools/fetch-hits.cjs
const fs = require('fs');
const { getJSON, sleep } = require('./lib.cjs');

const MET = [
  ['Under the Wave off Kanagawa', 'Hokusai', 'Japan'], ['Wheat Field with Cypresses', 'van Gogh', 'France'], ['Sunflowers', 'van Gogh', 'France'],
  ['Self-Portrait with a Straw Hat', 'van Gogh', 'France'], ['Irises', 'van Gogh', 'France'], ['Madame X', 'Sargent', 'France'],
  ['Washington Crossing the Delaware', 'Leutze', 'United States'], ['The Harvesters', 'Bruegel', 'Belgium'],
  ['Young Woman with a Water Pitcher', 'Vermeer', 'Netherlands'], ['The Death of Socrates', 'David', 'France'],
  ['Bridge over a Pond of Water Lilies', 'Monet', 'France'], ['Garden at Sainte-Adresse', 'Monet', 'France'],
  ['Circus Sideshow', 'Seurat', 'France'], ['The Card Players', 'Cézanne', 'France'], ['Mäda Primavesi', 'Klimt', 'Austria'],
  ['The Dance Class', 'Degas', 'France'], ['The Fortune-Teller', 'La Tour', 'France'], ['Aristotle with a Bust of Homer', 'Rembrandt', 'Netherlands'],
  ['The Horse Fair', 'Bonheur', 'France'], ['The Musicians', 'Caravaggio', 'Italy'], ['Juan de Pareja', 'Velázquez', 'Spain'],
  ['View of Toledo', 'Greco', 'Spain'], ['The Gulf Stream', 'Homer', 'United States'], ['Max Schmitt in a Single Scull', 'Eakins', 'United States'],
  ['The Oxbow', 'Cole', 'United States'], ['Reclining Nude', 'Modigliani', 'France'], ['Gertrude Stein', 'Picasso', 'France'],
  ['The Repast of the Lion', 'Rousseau', 'France'], ['Young Mother Sewing', 'Cassatt', 'France'], ['The Monet Family in Their Garden at Argenteuil', 'Manet', 'France']
];
const AIC = [
  ['The Scream', 'Edvard Munch', 'Norway'], ['The Child\'s Bath', 'Mary Cassatt', 'United States'], ['Paris Street; Rainy Day', 'Gustave Caillebotte', 'France'],
  ['At the Moulin Rouge', 'Toulouse-Lautrec', 'France'], ['Two Sisters (On the Terrace)', 'Renoir', 'France'], ['Bathers by a River', 'Henri Matisse', 'France'],
  ['Houses at Murnau', 'Vasily Kandinsky', 'Germany'], ['Madam Pompadour', 'Amedeo Modigliani', 'France'], ['Composition (No. 1) Gray-Red', 'Piet Mondrian', 'France'],
  ['The Poet\'s Garden', 'Vincent van Gogh', 'France'], ['Water Lily Pond', 'Claude Monet', 'France'], ['Madonna', 'Edvard Munch', 'Norway']
];
const CMA = [
  ['Water Lilies (Agapanthus)', 'Monet', 'France'], ['The Large Plane Trees', 'van Gogh', 'France'], ['Twilight in the Wilderness', 'Church', 'United States'],
  ['La Vie', 'Picasso', 'France'], ['Stag at Sharkey\'s', 'Bellows', 'United States'], ['The Burning of the Houses of Lords and Commons', 'Turner', 'England']
];
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function met([title, artist, country]) {
  const s = await getJSON(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&title=true&q=${encodeURIComponent(title)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  for (const id of (s?.objectIDs || []).slice(0, 12)) {
    const o = await getJSON(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    await sleep(500);
    if (!o || !norm(o.artistDisplayName).includes(norm(artist).split(' ').pop()) || !norm(o.title).startsWith(norm(title).slice(0, 12))) continue;
    if (!o.isPublicDomain || !o.primaryImageSmall) return { miss: `${title}: not open access at the Met` };
    return { ...o, country: o.country || country, museum: 'The Met', famous: true };
  }
  return { miss: `${title}: not found at the Met` };
}

async function aic([title, artist, country]) {
  const r = await fetch('https://api.artic.edu/api/v1/artworks/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'AIC-User-Agent': 'tiny-museum-quiz (portfolio project)' },
    body: JSON.stringify({ query: { bool: { must: [{ match_phrase: { title } }, { match: { artist_title: artist } }] } }, limit: 3,
      fields: ['id', 'title', 'artist_title', 'artist_display', 'date_display', 'date_start', 'date_end', 'place_of_origin', 'department_title', 'medium_display', 'classification_title', 'image_id', 'is_public_domain'] }) }).then((x) => x.json());
  const d = (r.data || [])[0];
  if (!d) return { miss: `${title}: not found at Chicago` };
  if (!d.is_public_domain || !d.image_id) return { miss: `${title}: not open access at Chicago` };
  return { objectID: `aic-${d.id}`, isPublicDomain: true, title: d.title, artistDisplayName: d.artist_title || '', artistDisplayBio: (d.artist_display || '').split('\n').slice(1).join(' '),
    objectDate: d.date_display || '', objectBeginDate: d.date_start, objectEndDate: d.date_end ?? d.date_start, culture: '', country: d.place_of_origin || country,
    department: d.department_title || '', medium: d.medium_display || '', classification: d.classification_title || '',
    primaryImageSmall: `https://www.artic.edu/iiif/2/${d.image_id}/full/843,/0/default.jpg`, objectURL: `https://www.artic.edu/artworks/${d.id}`, museum: 'Art Institute of Chicago', famous: true };
}

async function cma([title, artist, country]) {
  const j = await getJSON(`https://openaccess-api.clevelandart.org/api/artworks/?title=${encodeURIComponent(title)}&has_image=1&limit=5`);
  const d = (j?.data || []).find((x) => norm(JSON.stringify(x.creators)).includes(norm(artist)));
  if (!d) return { miss: `${title}: not found at Cleveland` };
  if (d.share_license_status !== 'CC0') return { miss: `${title}: not open access at Cleveland` };
  const [name, bio] = (/^(.*?)\s*\((.*)\)\s*$/.exec(d.creators?.[0]?.description || '') || []).slice(1);
  return { objectID: `cma-${d.id}`, isPublicDomain: true, title: d.title, artistDisplayName: name || '', artistDisplayBio: bio || '', objectDate: d.creation_date || '',
    objectBeginDate: d.creation_date_earliest, objectEndDate: d.creation_date_latest ?? d.creation_date_earliest, culture: (d.culture || [])[0] || '', country,
    department: d.department, medium: d.technique || '', classification: d.type || '', primaryImageSmall: d.images.web.url, objectURL: d.url, museum: 'Cleveland Museum of Art', famous: true };
}

(async () => {
  const out = [];
  for (const [fn, list] of [[met, MET], [aic, AIC], [cma, CMA]]) {
    for (const entry of list) {
      const r = await fn(entry).catch((e) => ({ miss: `${entry[0]}: ${e.message}` }));
      if (r.title && /^Under the Wave off Kanagawa/.test(r.title)) r.title = 'The Great Wave off Kanagawa';   // its catalog title is a paragraph
      if (r.miss) console.log('  -', r.miss); else { out.push(r); console.log('  +', r.museum, '|', r.title, '|', r.artistDisplayName, '|', r.objectDate); }
      await sleep(300);
    }
  }
  fs.writeFileSync('tools/raw-hits.json', JSON.stringify(out));
  console.log(`saved ${out.length} greatest hits`);
})();
