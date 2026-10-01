// Builds docs/quiz.json: picks quiz-worthy artworks from tools/raw*.json, writes each one's
// question + answer options, and has Azure OpenAI write a short witty note for each.
// Notes are cached in tools/notes.json so re-runs only pay for new artworks.
//
// The chosen pool is saved to tools/pool.json so rebuilds keep the same artworks (and their notes).
// Pass --reselect to pick again. Everything already live in docs/quiz.json is always kept.
//
// Usage: AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... node tools/build-quiz.cjs [--reselect] [--no-notes]
const fs = require('fs');
const { loadRaw } = require('./lib.cjs');

const raw = loadRaw();
const NOTES_PATH = 'tools/notes.json';
const POOL_PATH = 'tools/pool.json';
const notes = fs.existsSync(NOTES_PATH) ? JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8')) : {};
const RESELECT = process.argv.includes('--reselect') || !fs.existsSync(POOL_PATH);
const NO_NOTES = process.argv.includes('--no-notes');

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini';

// ---------- 1. Normalize ----------
const clean = (s) => (s || '').trim();
// A real person: at least two words, no parenthetical culture labels like "Mexica (Aztec)"
const CULTURE = /^(ancient |late |early )?(egyptian|greek|roman|spanish|french|italian|german|flemish|dutch|english|british|american|japanese|chinese|korean|indian|persian|iranian|maya|aztec|inca|mexica|moche|yoruba|edo|etruscan|byzantine|netherlandish|catalan|austrian|swiss|russian|coptic|islamic|nazca|olmec|teotihuacan|mughal|ottoman|tibetan|nepalese|thai|khmer|javanese|hopi|navajo|lakota|salado|mimbres|zapotec|huastec|wari|chimú|paracas|asante|kongo|luba|dogon|bamana|igbo)\b/i;
const isNamedArtist = (a) => a && !CULTURE.test(a) && /\s/.test(a) && !/[()]/.test(a) && !/^(unknown|anonymous|unidentified)/i.test(a) && !/workshop|manufactory|company|factory|studio|\bperiod\b|dynasty/i.test(a);
const century = (y) => {
  if (y < 1) return `${Math.ceil(Math.abs(y - 1) / 100)}th century BCE`.replace(/^1th/, '1st').replace(/^2th/, '2nd').replace(/^3th/, '3rd');
  const c = Math.ceil(y / 100);
  const suf = c % 100 >= 11 && c % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[c % 10] || 'th';
  return `${c}${suf} century`;
};
// Stable pseudo-random numbers from a string, so selection and question order don't churn between builds
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const seededShuffle = (a, seed) => a.map((x, i) => [hash(seed + ':' + i + ':' + JSON.stringify(x)), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

// Countries the quiz can ask about, grouped into regions (used for quotas and for fair wrong answers)
const REGIONS = {
  'South Asia': ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal'],
  'East & Southeast Asia': ['Japan', 'China', 'Korea', 'Tibet', 'Thailand', 'Cambodia', 'Vietnam', 'Indonesia', 'Myanmar'],
  'Islamic world': ['Iran', 'Turkey', 'Syria', 'Iraq', 'Egypt', 'Yemen', 'Afghanistan'],
  Europe: ['France', 'Italy', 'Spain', 'England', 'Netherlands', 'Belgium', 'Germany', 'Austria', 'Russia', 'Greece', 'Norway', 'Switzerland'],
  'Americas & Africa': ['United States', 'Canada', 'Mexico', 'Peru', 'Guatemala', 'Nigeria', 'Ghana', 'Mali', 'Democratic Republic of the Congo', 'Ethiopia']
};
const COUNTRIES = Object.values(REGIONS).flat();
const regionOfCountry = (c) => Object.keys(REGIONS).find((r) => REGIONS[r].includes(c)) || null;
// Place words museums use that imply a country
const ALIASES = [
  [/\bIndian\b|Mughal|Rajasthan|Rajput|Tamil Nadu|Pahari|Deccan|Gujarat|Mathura|Himachal|Punjab|Andhra|Uttar Pradesh|Karnataka|Kerala|Orissa|Odisha/, 'India'],
  [/Gandhara/, 'Pakistan'], [/Persia/, 'Iran'], [/Ottoman/, 'Turkey'], [/Burma/, 'Myanmar'], [/\bJava\b/, 'Indonesia'],
  [/Holland|Delft|Amsterdam|Haarlem/, 'Netherlands'], [/Flanders|Antwerp|Bruges/, 'Belgium'], [/Paris|Lyon/, 'France'],
  [/Rome|Venice|Florence|Naples/, 'Italy'], [/Vienna/, 'Austria'], [/Seville|Madrid/, 'Spain'], [/London/, 'England'],
  [/New York|Philadelphia|Boston|Florida|Nantucket|New Mexico|Chicago/, 'United States'], [/Thebes/, 'Egypt']
];
function countryOf(o) {
  const text = [o.country, o.culture].filter(Boolean).join(' | ');
  const found = new Set();
  for (const c of COUNTRIES) if (new RegExp(`\\b${c}\\b`).test(text)) found.add(c);
  for (const [re, c] of ALIASES) if (re.test(text)) found.add(c);
  // "Northern India or Pakistan" is ambiguous: don't ask about it
  return found.size === 1 ? [...found][0] : null;
}

const items = raw
  .map((o) => ({
    id: o.objectID,
    title: clean(o.title),
    // Met folios often credit the poet or calligrapher, not the painter
    artist: /author|poet|calligrapher/i.test(o.artistRole || '') ? '' : clean(o.artistDisplayName),
    artistBio: clean(o.artistDisplayBio),
    date: clean(o.objectDate),
    year: o.objectBeginDate,
    yearEnd: Number.isFinite(o.objectEndDate) ? o.objectEndDate : o.objectBeginDate,
    culture: clean(o.culture),
    country: clean(o.country),
    dept: clean(o.department),
    medium: clean(o.medium),
    classification: clean(o.classification),
    img: o.primaryImageSmall,
    url: o.objectURL,
    museum: o.museum || 'The Met',
    famous: o.famous ?? o.museum === 'Art Institute of Chicago'
  }))
  .filter((o) => o.title && o.img && Number.isFinite(o.year))
  .map((o) => {
    const c = countryOf(o);
    const region = /islamic/i.test(o.dept) ? 'Islamic world' : regionOfCountry(c);
    return { ...o, place: c, region };
  });
const byId = Object.fromEntries(items.map((o) => [o.id, o]));

// ---------- 2. Choose the pool ----------
// Keep everything already live, then add new works by region quota: famous ones first
const QUOTA = { 'South Asia': 105, 'East & Southeast Asia': 70, 'Islamic world': 35, Europe: 75, 'Americas & Africa': 5 };
let poolIds;
if (RESELECT) {
  const live = fs.existsSync('docs/quiz.json') ? JSON.parse(fs.readFileSync('docs/quiz.json', 'utf8')).items.map((i) => i.id).filter((id) => byId[id]) : [];
  const keep = new Set(live);
  const titles = new Set(live.map((id) => byId[id].title.toLowerCase()));
  for (const region in QUOTA) {
    const cands = seededShuffle(items.filter((o) => o.region === region && !keep.has(o.id)), region)
      .sort((a, b) => b.famous - a.famous);
    let n = 0;
    for (const o of cands) {
      if (n >= QUOTA[region]) break;
      if (titles.has(o.title.toLowerCase())) continue;
      keep.add(o.id); titles.add(o.title.toLowerCase()); n++;
    }
  }
  poolIds = [...keep];
  fs.writeFileSync(POOL_PATH, JSON.stringify(poolIds, null, 1));
} else {
  poolIds = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8')).filter((id) => byId[id]);
}
// The hand-picked greatest hits (tools/fetch-hits.cjs) are always in
const HITS = fs.existsSync('tools/raw-hits.json') ? JSON.parse(fs.readFileSync('tools/raw-hits.json', 'utf8')).map((o) => o.objectID) : [];
const added = HITS.filter((id) => byId[id] && !poolIds.includes(id));
if (added.length) { poolIds.push(...added); fs.writeFileSync(POOL_PATH, JSON.stringify(poolIds, null, 1)); console.log(`added ${added.length} greatest hits to the pool`); }
const poolItems = poolIds.map((id) => byId[id]);

// ---------- 3. Write a question for each ----------
// Ask "Who made this?" for famous works, or artists with 2+ works in the pool (skip "Master of ..." names)
const artistCount = {};
for (const o of poolItems) if (isNamedArtist(o.artist)) artistCount[o.artist] = (artistCount[o.artist] || 0) + 1;
const artistMedian = {};
for (const a in artistCount) {
  const ys = poolItems.filter((o) => o.artist === a).map((o) => o.year).sort((x, y) => x - y);
  artistMedian[a] = ys[Math.floor(ys.length / 2)];
}
const artists = Object.keys(artistCount);
const artistRegion = {};
for (const o of poolItems) if (artistCount[o.artist]) artistRegion[o.artist] ||= o.region;

function makeQuestion(o) {
  const rnd = (k) => hash(o.id + k);
  const pick = (arr, n, k) => seededShuffle(arr, o.id + k).slice(0, n);
  if (isNamedArtist(o.artist) && (o.famous || artistCount[o.artist] >= 2) && !/^Master of|\bMaster$/.test(o.artist)) {
    // Distractors: real artists from the pool, closest in time, strongly preferring the same region, then department
    const near = artists
      .filter((a) => a !== o.artist)
      .map((a) => ({ a, d: Math.abs(artistMedian[a] - o.year) + (artistRegion[a] === o.region ? 0 : 400) + (poolItems.some((x) => x.artist === a && x.dept === o.dept) ? 0 : 80) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 9)
      .map((x) => x.a);
    const wrong = pick(near, 3, 'who');
    if (wrong.length === 3) return { q: 'Who made this?', a: o.artist, opts: pick([o.artist, ...wrong], 4, 'whoOpts') };
  }
  // Only ask "when" if the work sits inside one century
  const cOf = (y) => (y < 1 ? Math.floor((y - 1) / 100) : Math.ceil(y / 100));
  const canWhen = cOf(o.year) === cOf(o.yearEnd);
  // Anonymous works get a mix of "where" and "when" so the Indian gallery isn't always "India"
  if (o.place && !(canWhen && rnd('mix') < 0.4)) {
    // Half the wrong answers come from the same region, so it's not trivially easy
    const same = pick(REGIONS[regionOfCountry(o.place)].filter((c) => c !== o.place), 2, 'same');
    const rest = pick(COUNTRIES.filter((c) => c !== o.place && !same.includes(c)), 3 - same.length, 'rest');
    return { q: 'Where does this come from?', a: o.place, opts: pick([o.place, ...same, ...rest], 4, 'whereOpts') };
  }
  if (!canWhen) return null;
  const right = century(o.year);
  // Nearby centuries only, and nothing later than the 20th (future decoys are too easy)
  const offsets = pick([-4, -3, -2, -1, 1, 2, 3, 4].filter((k) => o.year + k * 100 <= 2000), 3, 'when');
  return { q: 'When was this made?', a: right, opts: pick([right, ...offsets.map((k) => century(o.year + k * 100))], 4, 'whenOpts') };
}

// Which frame suits the work: gilt for oils, a scroll mount for East Asian hanging works,
// a cream mat for works on paper, a plinth for objects, and a plain frame for modern work
function frameOf(o) {
  const s = `${o.classification} ${o.medium} ${o.dept}`.toLowerCase();
  if (/sculpt|bronze|stone|ceramic|porcelain|stoneware|earthenware|metal|jade|lacquer|wood|terracotta|marble|sandstone|schist|jewel|vessel|glass|ivory|silver|gold|copper/.test(s) && !/on paper|on silk|painting|print|folio|manuscript|album/.test(s)) return 'plinth';
  if (/scroll/.test(s) && o.region === 'East & Southeast Asia') return 'scroll';
  if (/print|woodblock|drawing|watercolor|gouache|on paper|folio|manuscript|album|miniature|tempera and gold|photograph|textile|carpet|rug/.test(s)) return 'mat';
  if (o.year >= 1900) return 'plain';
  return 'gilt';
}

// Short region codes for the site (the daily 10 always includes some South and East Asian work)
const RG = { 'South Asia': 'sa', 'East & Southeast Asia': 'ea', 'Islamic world': 'is', Europe: 'eu', 'Americas & Africa': 'am' };

const pool = poolItems.map((o) => ({ o, q: makeQuestion(o) })).filter((x) => x.q).map(({ o, q }) => ({ ...o, ...q }));

// ---------- 4. AI notes ----------
const SYSTEM = `You write the reveal card for an art quiz. Voice: a witty, well-read friend. Simple words, clear, sharp, fun.
The player already sees the title, artist, date and place, so NEVER repeat them as the opening. Start with the hook.
Write 2 or 3 short sentences, 50 words max:
- Lead with the single most surprising TRUE thing: a story behind it, why it mattered, or a detail worth noticing.
- You can see the image. Only point to visual details that are actually there.
- Only state facts you are confident about. If unsure, be playful about what's visible instead of inventing history.
- For South Asian, East Asian and Islamic works, name the tradition, school or deity specifically when you are confident (for example Pahari, Chola, Mughal, ukiyo-e). Don't flatten it into "Eastern" or "exotic".
- Be funny where it fits: a wry aside, a modern comparison, a raised eyebrow. Not corny.
- Never start with "Notice", "Look closely" or "This". No hashtags, no emojis, no "this artwork", "masterpiece", "captures", "invites", "timeless".
Example (for Seurat's A Sunday on La Grande Jatte): "Every inch is made of tiny dots of pure color that your eye blends from a distance. Seurat spent two years on it. Also, someone brought a pet monkey to the park, and nobody seems bothered."
Return JSON: {"note": "..."}`;

// The model can't fetch museum image URLs itself, so send the local copy (tools/fetch-images.cjs) inline
async function imageDataUrl(id) {
  return `data:image/jpeg;base64,${fs.readFileSync(`docs/img/${id}.jpg`).toString('base64')}`;
}

async function writeNote(o, withImage = true) {
  const image = withImage ? await imageDataUrl(o.id) : null;
  const facts = [
    `Title: ${o.title}`,
    o.artist && `Artist: ${o.artist}${o.artistBio ? ` (${o.artistBio})` : ''}`,
    o.date && `Date: ${o.date}`,
    (o.culture || o.country) && `Culture/place: ${[o.culture, o.country].filter(Boolean).join(', ')}`,
    o.medium && `Medium: ${o.medium}`,
    `Collection: ${o.museum}, ${o.dept}`
  ].filter(Boolean).join('\n');
  const res = await fetch(`${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=2025-01-01-preview`, { signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': KEY },
    body: JSON.stringify({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: image
        ? [{ type: 'text', text: facts }, { type: 'image_url', image_url: { url: image, detail: 'high' } }]
        : facts + '\n(You cannot see the image this time. Do not describe visual details; stick to well-known facts.)' }],
      temperature: 0.8,
      max_tokens: 200,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const j = await res.json();
  return JSON.parse(j.choices[0].message.content).note.trim();
}

(async () => {
  const haveImg = (o) => fs.existsSync(`docs/img/${o.id}.jpg`);
  const todo = NO_NOTES ? [] : pool.filter((o) => !notes[o.id] && haveImg(o));
  console.log(`pool ${pool.length} (${pool.filter(haveImg).length} with images), notes cached ${pool.filter((o) => notes[o.id]).length}, to write ${todo.length}`);
  if (todo.length && (!ENDPOINT || !KEY)) throw new Error('Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY');
  let n = 0;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const o = queue.shift();
      for (let t = 0; t < 3; t++) {
        try { notes[o.id] = await writeNote(o, !/content safety|content_filter/i.test(o.lastErr || '')); break; } catch (e) { o.lastErr = e.message; if (t === 2) console.error(`note failed for ${o.id}: ${e.message.slice(0, 120)}`); await new Promise((r) => setTimeout(r, 1500 * (t + 1))); }
      }
      if (++n % 50 === 0) { console.log(`${n}/${todo.length} notes`); fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 1)); }
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.CONC || 5) }, worker));
  fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 1));

  // Prefer fact-checked notes when tools/fact-check.cjs has run
  const final = fs.existsSync('tools/notes-final.json') ? JSON.parse(fs.readFileSync('tools/notes-final.json', 'utf8')) : {};
  // Only ship artworks whose image was saved locally (tools/fetch-images.cjs)
  const out = pool.filter((o) => notes[o.id] && haveImg(o)).map((o) => ({
    id: o.id, t: o.title, by: isNamedArtist(o.artist) ? o.artist : null, d: o.date, place: o.place || o.culture || o.country || null,
    img: `img/${o.id}.jpg`, url: o.url, museum: o.museum, q: o.q, a: o.a, opts: o.opts, note: final[o.id] || notes[o.id],
    fr: frameOf(o), rg: RG[o.region] || 'x', ...(o.famous ? { f: 1 } : {}), ...(HITS.includes(o.id) ? { h: 1 } : {})
  }));
  fs.writeFileSync('docs/quiz.json', JSON.stringify({ built: new Date().toISOString().slice(0, 10), items: out }));
  const count = (k) => out.reduce((a, o) => ((a[o[k]] = (a[o[k]] || 0) + 1), a), {});
  const regions = out.reduce((a, o) => { const r = byId[o.id].region || 'other'; a[r] = (a[r] || 0) + 1; return a; }, {});
  console.log(`wrote docs/quiz.json: ${out.length} items, ${(fs.statSync('docs/quiz.json').size / 1024).toFixed(0)} KB`);
  console.log('regions', regions);
  console.log('questions', count('q'));
  console.log('museums', count('museum'));
  console.log('frames', count('fr'));
})();
