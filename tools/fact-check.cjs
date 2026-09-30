// Second pass over tools/notes.json: an editor model checks each note against the image and
// catalog facts, and rewrites anything that isn't well-established or clearly visible.
// Results are cached in tools/checked.json; docs/quiz.json is rebuilt by build-quiz.cjs after.
//
// Usage: AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... AZURE_OPENAI_DEPLOYMENT=gpt-4.1 node tools/fact-check.cjs
const fs = require('fs');

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
const CONC = Number(process.env.CONC || 3);

const raw = require('./lib.cjs').loadRaw();
const byId = Object.fromEntries(raw.map((o) => [o.objectID, o]));
const notes = JSON.parse(fs.readFileSync('tools/notes.json', 'utf8'));
const CHECKED = 'tools/checked.json';
const checked = fs.existsSync(CHECKED) ? JSON.parse(fs.readFileSync(CHECKED, 'utf8')) : {};

const EDITOR = `You are the fact-checking editor for a witty art-quiz note. You can see the artwork.
Check every claim in the note:
- Keep claims that are well-established art history or clearly visible in the image.
- Remove or soften anything speculative, invented, or contradicted by the image (e.g. relationships between figures, hidden meanings, object functions you can't confirm).
- Replace social-media or "influencer" comparisons with a different joke.
- Keep the witty-friend voice, 2 or 3 short sentences, 55 words max. Don't start with "Notice", "Look closely" or "This". Never use "masterpiece", "captures", "invites", "timeless".
Return JSON: {"changed": true|false, "issues": "short list of what was wrong, or empty", "note": "final note"}`;

async function imageDataUrl(id) {
  return `data:image/jpeg;base64,${fs.readFileSync(`docs/img/${id}.jpg`).toString('base64')}`;
}

async function check(id, withImage) {
  const o = byId[id];
  const facts = [`Title: ${o.title}`, o.artistDisplayName && `Artist: ${o.artistDisplayName}`, o.objectDate && `Date: ${o.objectDate}`,
    o.country && `Place: ${o.country}`, o.medium && `Medium: ${o.medium}`, `Note to check: ${notes[id]}`].filter(Boolean).join('\n');
  const content = withImage
    ? [{ type: 'text', text: facts }, { type: 'image_url', image_url: { url: await imageDataUrl(id), detail: 'high' } }]
    : facts + '\n(No image available this time: remove any visual claims you cannot verify from well-known facts.)';
  const res = await fetch(`${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=2025-01-01-preview`, { signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': KEY },
    body: JSON.stringify({ messages: [{ role: 'system', content: EDITOR }, { role: 'user', content }], temperature: 0.2, max_tokens: 300, response_format: { type: 'json_object' } })
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

(async () => {
  const todo = Object.keys(notes).filter((id) => !checked[id] || checked[id].source !== notes[id]);
  console.log(`notes ${Object.keys(notes).length}, to check ${todo.length}`);
  let n = 0;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      let last = '';
      for (let t = 0; t < 4; t++) {
        try {
          const r = await check(id, !/content safety|content_filter/i.test(last));
          checked[id] = { source: notes[id], note: r.note.trim(), changed: !!r.changed, issues: r.issues || '' };
          break;
        } catch (e) { last = e.message; if (t === 3) console.error(`check failed for ${id}: ${last}`); await new Promise((r) => setTimeout(r, 4000 * (t + 1))); }
      }
      if (++n % 25 === 0) { console.log(`${n}/${todo.length} checked`); fs.writeFileSync(CHECKED, JSON.stringify(checked, null, 1)); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(CHECKED, JSON.stringify(checked, null, 1));
  // Apply checked versions back into notes.json so build-quiz.cjs picks them up
  const final = { ...notes };
  for (const id in checked) if (checked[id].source === notes[id]) final[id] = checked[id].note;
  fs.writeFileSync('tools/notes-final.json', JSON.stringify(final, null, 1));
  const changed = Object.values(checked).filter((c) => c.changed).length;
  console.log(`done. ${changed} of ${Object.keys(checked).length} notes were corrected. Wrote tools/notes-final.json`);
})();
