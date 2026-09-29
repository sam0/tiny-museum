// Builds docs/quiz.json: picks quiz-worthy artworks from tools/raw.json, writes each one's
// question + answer options, and has Azure OpenAI write a short witty note for each.
// Notes are cached in tools/notes.json so re-runs only pay for new artworks.
//
// Usage: AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... node tools/build-quiz.cjs [--limit N]
const fs = require('fs');

const raw = ['tools/raw.json', 'tools/raw-aic.json']
  .filter((f) => fs.existsSync(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const NOTES_PATH = 'tools/notes.json';
const notes = fs.existsSync(NOTES_PATH) ? JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8')) : {};
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini';

// ---------- 1. Choose the pool ----------
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

const items = raw
  .map((o) => ({
    id: o.objectID,
    title: clean(o.title),
    artist: clean(o.artistDisplayName),
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
    museum: o.museum || 'The Met'
  }))
  .filter((o) => o.title && o.img && Number.isFinite(o.year));

// Count how often each artist appears: famous names with several works make the best artist questions
const artistCount = {};
for (const o of items) if (isNamedArtist(o.artist)) artistCount[o.artist] = (artistCount[o.artist] || 0) + 1;

const artistMedian = {};
for (const a in artistCount) {
  const ys = items.filter((o) => o.artist === a).map((o) => o.year).sort((x, y) => x - y);
  artistMedian[a] = ys[Math.floor(ys.length / 2)];
}
const artists = Object.keys(artistCount);

function pickDistinct(pool, n, exclude) {
  const out = [];
  for (const x of pool) { if (x !== exclude && !out.includes(x)) out.push(x); if (out.length === n) break; }
  return out;
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- 2. Write a question for each ----------
const COUNTRIES = ['Japan', 'China', 'Korea', 'India', 'France', 'Italy', 'Spain', 'England', 'Netherlands', 'Belgium', 'Germany', 'Austria',
  'Russia', 'Egypt', 'Greece', 'Iran', 'Turkey', 'Mexico', 'Peru', 'Guatemala', 'United States', 'Canada', 'Nigeria', 'Ghana', 'Mali',
  'Democratic Republic of the Congo', 'Norway', 'Switzerland', 'Tibet', 'Nepal', 'Thailand', 'Cambodia', 'Indonesia'];
const countryOf = (o) => COUNTRIES.find((c) => (o.country || '') === c || (o.culture || '') === c) || null;

function makeQuestion(o) {
  if (isNamedArtist(o.artist)) {
    // Distractors: real artists from the pool, closest in time, preferring the same department
    const near = artists
      .filter((a) => a !== o.artist)
      .map((a) => ({ a, d: Math.abs(artistMedian[a] - o.year) + (items.some((x) => x.artist === a && x.dept === o.dept) ? 0 : 80) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 9)
      .map((x) => x.a);
    const wrong = pickDistinct(shuffle(near), 3, o.artist);
    if (wrong.length === 3) return { q: 'Who made this?', a: o.artist, opts: shuffle([o.artist, ...wrong]) };
  }
  const country = countryOf(o);
  if (country) {
    const wrong = shuffle(COUNTRIES.filter((c) => c !== country)).slice(0, 3);
    return { q: 'Where does this come from?', a: country, opts: shuffle([country, ...wrong]) };
  }
  // Only ask "when" if the work sits inside one century, and never offer a century that overlaps its dates
  const cOf = (y) => (y < 1 ? Math.floor((y - 1) / 100) : Math.ceil(y / 100));
  if (cOf(o.year) !== cOf(o.yearEnd)) return null;
  const right = century(o.year);
  // Nearby centuries only, and nothing later than the 20th (future decoys are too easy)
  const offsets = shuffle([-4, -3, -2, -1, 1, 2, 3, 4].filter((k) => o.year + k * 100 <= 2000)).slice(0, 3);
  return { q: 'When was this made?', a: right, opts: shuffle([right, ...offsets.map((k) => century(o.year + k * 100))]) };
}

// Favor a varied, recognizable pool: all named-artist paintings, plus a spread of objects from every department
const byDept = {};
for (const o of items) (byDept[o.dept] ||= []).push(o);
const chosen = [];
for (const dept in byDept) {
  const list = byDept[dept];
  const art = list.filter((o) => isNamedArtist(o.artist));
  const rest = shuffle(list.filter((o) => !isNamedArtist(o.artist)));
  chosen.push(...art.slice(0, 60), ...rest.slice(0, 14));
}
const pool = shuffle(chosen).slice(0, Math.min(LIMIT, 420)).map((o) => ({ o, q: makeQuestion(o) })).filter((x) => x.q).map(({ o, q }) => ({ ...o, ...q }));

// ---------- 3. AI notes ----------
const SYSTEM = `You write the reveal card for an art quiz. Voice: a witty, well-read friend. Simple words, clear, sharp, fun.
The player already sees the title, artist, date and place, so NEVER repeat them as the opening. Start with the hook.
Write 2 or 3 short sentences, 50 words max:
- Lead with the single most surprising TRUE thing: a story behind it, why it mattered, or a detail worth noticing.
- You can see the image. Only point to visual details that are actually there.
- Only state facts you are confident about. If unsure, be playful about what's visible instead of inventing history.
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
  const todo = pool.filter((o) => !notes[o.id]);
  console.log(`pool ${pool.length}, notes cached ${pool.length - todo.length}, to write ${todo.length}`);
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
  const out = pool.filter((o) => notes[o.id] && fs.existsSync(`docs/img/${o.id}.jpg`)).map((o) => ({
    id: o.id, t: o.title, by: o.artist || null, d: o.date, place: o.culture || o.country || null,
    img: `img/${o.id}.jpg`, url: o.url, museum: o.museum, q: o.q, a: o.a, opts: o.opts, note: final[o.id] || notes[o.id]
  }));
  fs.writeFileSync('docs/quiz.json', JSON.stringify({ built: new Date().toISOString().slice(0, 10), items: out }));
  const kinds = out.reduce((a, o) => ((a[o.q] = (a[o.q] || 0) + 1), a), {});
  console.log(`wrote docs/quiz.json: ${out.length} items`, kinds, `${(fs.statSync('docs/quiz.json').size / 1024).toFixed(0)} KB`);
})();
