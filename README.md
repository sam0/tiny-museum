# Tiny Museum

**Play: https://sam0.github.io/tiny-museum/**

A daily art quiz. Ten famous artworks a day: guess who made it, where it's from, or when.
Then the card flips to a short, witty note on why the piece is worth a second look.

- **Today's 10:** everyone gets the same ten artworks each day, with a shareable 🟩🟥 score grid
- **Endless practice:** keep going through all ~190 artworks
- **Ranks:** from "Gift Shop Regular" to "Chief Curator"

## How it uses AI

All the AI work happens when the site is built, not while you play, so the site is static,
instant and free to host.

1. **Writer:** for each artwork, a vision model (Azure OpenAI GPT-4.1) is shown the image plus the
   museum's catalog facts, and writes a 2–3 sentence note in a witty-friend voice.
2. **Fact-checker:** a second pass with the same model looks at the image and the note again,
   removes or softens anything speculative or not clearly visible, and keeps the jokes.
   It rewrote about 60% of the first drafts.

Quiz questions are built from the catalog data. Wrong answers are real artists from the same era,
real countries, or nearby centuries, and "when" questions are skipped for works made over more
than one century so there's always exactly one right answer.

## Build

```bash
node tools/fetch-aic.cjs                 # artworks from the Art Institute of Chicago API
bash: see tools/fetch-images.cjs         # save images to docs/img (curl works best)
AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... AZURE_OPENAI_DEPLOYMENT=gpt-4.1 node tools/build-quiz.cjs
AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... node tools/fact-check.cjs
node tools/build-quiz.cjs                # rebuild docs/quiz.json with the checked notes
```

Artworks and images: Art Institute of Chicago, open access (CC0).
