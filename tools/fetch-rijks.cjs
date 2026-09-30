// Pulls public-domain artworks from the Rijksmuseum's Linked Art data services into tools/raw-rijks.json.
// A seed list of famous works comes first, then a few paintings or prints by each headline artist.
// Each object takes three hops: object -> visual item -> digital object (the IIIF image).
// Usage: node tools/fetch-rijks.cjs
const fs = require('fs');
const { getJSON, sleep } = require('./lib.cjs');

const SEARCH = 'https://data.rijksmuseum.nl/search/collection';
const LD = { headers: { Accept: 'application/ld+json' } };
const EN = 'http://vocab.getty.edu/aat/300388277';

// Object numbers of the museum's best-known works
const FAMOUS = ['SK-C-5', 'SK-A-2344', 'SK-C-216', 'SK-A-2860', 'SK-A-1595', 'SK-A-4050', 'SK-C-6', 'SK-A-4118', 'SK-A-3262',
  'SK-A-1718', 'SK-A-385', 'SK-A-135', 'SK-A-133', 'SK-A-3584', 'SK-C-1368', 'SK-A-3059', 'SK-A-4691', 'SK-A-2963', 'SK-A-180', 'SK-C-149'];
const ARTISTS = [
  ['Rembrandt van Rijn', 'painting', 10, 'Netherlands'], ['Johannes Vermeer', 'painting', 4, 'Netherlands'],
  ['Frans Hals', 'painting', 5, 'Netherlands'], ['Jan Havicksz. Steen', 'painting', 4, 'Netherlands'],
  ['Vincent van Gogh', 'painting', 3, 'Netherlands'], ['Pieter de Hooch', 'painting', 3, 'Netherlands'],
  ['Jacob Isaacksz. van Ruisdael', 'painting', 3, 'Netherlands'], ['Hendrick Avercamp', 'painting', 2, 'Netherlands'],
  ['Judith Leyster', 'painting', 2, 'Netherlands'], ['Rachel Ruysch', 'painting', 2, 'Netherlands'],
  ['Gerard ter Borch (II)', 'painting', 2, 'Netherlands'], ['Adriaen Coorte', 'painting', 2, 'Netherlands'],
  ['Katsushika Hokusai', 'print', 8, 'Japan'], ['Utagawa Hiroshige (I)', 'print', 8, 'Japan'], ['Kitagawa Utamaro (I)', 'print', 3, 'Japan']
];

const DUTCH = /\b(met|langs|en|de|rol|Twee|Kwartels|Bamboe|Halvemaan|bergopwaarts)\b/;
const en = (arr) => (arr || []).find((x) => (x.language || []).some((l) => l.id === EN));
const note = (n) => [].concat(n || []).find((x) => x['@language'] === 'en')?.['@value'] || [].concat(n || [])[0]?.['@value'] || '';

async function idsFor(params, n) {
  const j = await getJSON(`${SEARCH}?${new URLSearchParams(params)}`);
  return (j?.orderedItems || []).slice(0, n).map((x) => x.id);
}

// "Jan Havicksz. Steen" -> "Jan Steen", "Utagawa Hiroshige (I)" -> "Utagawa Hiroshige"
const tidy = (n) => n.replace(/\s*\((mentioned on object|signed by artist)\)/g, '').replace(/\s*\((I|II)\)$/, '').replace(/ Havicksz\.| Isaacksz\.?/, '').replace(/^(painter|printmaker|designer|draughtsman|schilder): /i, '').trim();

async function record(id, country, famous, creator) {
  const d = await getJSON(id, LD);
  if (!d) return null;
  const vis = d.shows?.[0]?.id && await getJSON(d.shows[0].id, LD);
  const dig = vis?.digitally_shown_by?.[0]?.id && await getJSON(vis.digitally_shown_by[0].id, LD);
  const img = dig?.access_point?.[0]?.id;
  if (!img || !/publicdomain/.test(JSON.stringify(vis.subject_to || ''))) return null;
  const names = (d.identified_by || []).filter((x) => x.type === 'Name');
  const num = (d.identified_by || []).find((x) => x.type === 'Identifier')?.content;
  const ts = d.produced_by?.timespan || {};
  const person = d.produced_by?.part?.[0]?.carried_out_by?.[0];
  const page = JSON.stringify(d.subject_of || '').match(/https:\/\/www\.rijksmuseum\.nl\/nl\/collectie\/object\/[^"]+/)?.[0];
  return {
    objectID: `rijks-${num}`,
    isPublicDomain: true,
    title: (en(names) || names[0])?.content || '',
    artistDisplayName: tidy(person ? note(person.notation) : (en(d.produced_by?.referred_to_by)?.content || creator || '')),
    artistDisplayBio: '',
    objectDate: (en(ts.identified_by) || ts.identified_by?.[0])?.content || '',
    objectBeginDate: ts.begin_of_the_begin ? Number(ts.begin_of_the_begin.slice(0, 4)) : NaN,
    objectEndDate: ts.end_of_the_end ? Number(ts.end_of_the_end.slice(0, 4)) : NaN,
    culture: '',
    country,
    department: 'Rijksmuseum',
    medium: en((d.referred_to_by || []).filter((x) => JSON.stringify(x.classified_as || '').includes('300435429')))?.content || '',
    classification: note(d.classified_as?.[0]?.notation),
    primaryImageSmall: img.replace('/full/max/', '/full/720,/'),
    objectURL: page ? page.replace('/nl/collectie/', '/en/collection/') : `https://www.rijksmuseum.nl/en/collection/${num}`,
    museum: 'Rijksmuseum',
    famous
  };
}

(async () => {
  const jobs = [];
  for (const num of FAMOUS) jobs.push({ ids: () => idsFor({ objectNumber: num }, 1), country: 'Netherlands', famous: true });
  // Goya's portrait is Spanish; everything else in the seed list is Dutch
  for (const [creator, type, n, country] of ARTISTS) jobs.push({ ids: () => idsFor({ creator, type, imageAvailable: 'true' }, n), country, creator, famous: creator === 'Johannes Vermeer' });
  const out = [], seen = new Set();
  for (const job of jobs) {
    for (const id of await job.ids()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const r = await record(id, job.country, job.famous, job.creator);
      if (r && /Goya/.test(r.artistDisplayName)) r.country = 'Spain';
      // Skip uncertain attributions and prints that only have a Dutch title
      const keep = r && r.title && Number.isFinite(r.objectBeginDate) && !/^attributed/i.test(r.artistDisplayName) && !(r.country === 'Japan' && DUTCH.test(r.title));
      if (keep) { out.push(r); console.log(`${r.famous ? '*' : ' '} ${r.objectID} ${r.title} | ${r.artistDisplayName} | ${r.objectDate}`); }
      await sleep(150);
    }
  }
  fs.writeFileSync('tools/raw-rijks.json', JSON.stringify(out));
  console.log(`saved ${out.length} artworks`);
})();
