// Pulls CC0 artworks from the Cleveland Museum of Art's Open Access API into tools/raw-cleveland.json.
// Leans hard on its Indian and Southeast Asian collection, plus Japan, China, Korea and the Islamic world.
// "Popular" is approximated: museum highlights first, then works on view, then works with wall text.
// Usage: node tools/fetch-cleveland.cjs
const fs = require('fs');
const { getJSON, sleep } = require('./lib.cjs');

const API = 'https://openaccess-api.clevelandart.org/api/artworks/';
const PLAN = [
  { dept: 'Indian and Southeast Asian Art', types: ['Painting', 'Sculpture', 'Manuscript'], take: 110 },
  { dept: 'Japanese Art', types: ['Print', 'Painting', 'Sculpture'], take: 25 },
  { dept: 'Chinese Art', types: ['Painting', 'Sculpture', 'Ceramic'], take: 25 },
  { dept: 'Korean Art', types: ['Painting', 'Ceramic'], take: 10 },
  { dept: 'Islamic Art', types: ['Painting', 'Manuscript', 'Ceramic', 'Metalwork'], take: 15 },
  { dept: 'European Painting and Sculpture', types: ['Painting'], take: 15 }
];
const FIELDS = 'id,accession_number,title,creation_date,creation_date_earliest,creation_date_latest,culture,technique,department,collection,type,url,images,creators,is_highlight,current_location,did_you_know,description';

const score = (d) => (d.is_highlight ? 10 : 0) + (d.current_location ? 4 : 0) + (d.did_you_know ? 2 : 0) + (d.description ? 1 : 0);
// "Mughal India, court of Akbar" -> India; "Cambodia, Angkor period" -> Cambodia
const PLACES = ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Tibet', 'Cambodia', 'Thailand', 'Indonesia', 'Myanmar', 'Vietnam',
  'Japan', 'China', 'Korea', 'Iran', 'Turkey', 'Egypt', 'Syria', 'Iraq', 'Afghanistan', 'France', 'Italy', 'Spain', 'Netherlands', 'Flanders', 'England', 'Germany'];
const placeOf = (culture) => {
  const s = (culture || []).join(' ');
  if (/Persia/.test(s)) return 'Iran';
  if (/Ottoman|Turkey/.test(s)) return 'Turkey';
  return PLACES.find((p) => s.includes(p)) || '';
};
// "Katsushika Hokusai (Japanese, 1760–1849)" -> name + bio
const splitCreator = (c) => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(c?.description || ''); return m ? [m[1], m[2]] : [c?.description || '', '']; };

(async () => {
  const out = [];
  for (const p of PLAN) {
    const found = [];
    for (const type of p.types) {
      const url = `${API}?department=${encodeURIComponent(p.dept)}&type=${encodeURIComponent(type)}&cc0=1&has_image=1&limit=1000&fields=${FIELDS}`;
      const j = await getJSON(url);
      found.push(...(j?.data || []));
      await sleep(500);
    }
    const picked = found.filter((d) => d.images?.web?.url && Number.isFinite(d.creation_date_earliest))
      .sort((a, b) => score(b) - score(a) || a.id - b.id)
      .slice(0, p.take);
    for (const d of picked) {
      const [name, bio] = splitCreator(d.creators?.[0]);
      out.push({
        objectID: `cma-${d.id}`,
        isPublicDomain: true,
        title: d.title,
        artistDisplayName: name,
        artistDisplayBio: bio,
        objectDate: d.creation_date || '',
        objectBeginDate: d.creation_date_earliest,
        objectEndDate: d.creation_date_latest ?? d.creation_date_earliest,
        culture: (d.culture || [])[0] || '',
        country: placeOf(d.culture),
        department: d.department,
        medium: d.technique || '',
        classification: d.type || '',
        primaryImageSmall: d.images.web.url,
        objectURL: d.url,
        museum: 'Cleveland Museum of Art',
        famous: !!d.is_highlight || score(d) >= 6
      });
    }
    console.log(`${p.dept}: ${found.length} candidates, kept ${picked.length}`);
  }
  fs.writeFileSync('tools/raw-cleveland.json', JSON.stringify(out));
  console.log(`saved ${out.length} artworks`);
})();
