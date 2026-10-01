# Tiny Museum

**Play: https://sam0.github.io/tiny-museum/**

A daily art quiz. Ten famous artworks a day, from Amsterdam to Tamil Nadu: guess who made it, where it's from,
when, or which museum holds it. Then the card flips to a short, witty note on why the piece is worth a second look.

- **Today's 10:** everyone gets the same ten artworks each day: always two greatest hits (The Scream, The Great Wave, Sunflowers...), plus South Asian, East Asian and Islamic-world art.
- **Results you can explore:** tap any of the day's ten to open it at its museum
- **Endless practice:** keep going through all ~500 artworks
- **Frames that fit the art:** gilt for oils, a silk scroll mount for East Asian hanging scrolls, a cream mat for miniatures and prints, a plinth for sculpture
- **After hours:** after 9pm the museum is closed and you only have a flashlight (try `?afterhours`). Gerald the guard works nights.

## Collections

All images are open access and self-hosted in `docs/img`:

| Museum | Fetcher | What's in the quiz |
|---|---|---|
| Art Institute of Chicago | `tools/fetch-aic.cjs` | The museum's most-viewed public-domain works |
| Rijksmuseum | `tools/fetch-rijks.cjs` | Rembrandt, Vermeer, Hals, Steen and the Golden Age; Hokusai and Hiroshige prints |
| The Met | `tools/fetch-pool.cjs` | Highlights from Asian Art, Islamic Art (Mughal albums) and European Paintings |
| Greatest hits (Met, Chicago, Cleveland) | `tools/fetch-hits.cjs` | ~40 of the most recognizable open-access works: The Scream, The Great Wave, Van Gogh's Sunflowers, Washington Crossing the Delaware, Madame X, Klimt, Kandinsky, Mondrian |
| Cleveland Museum of Art | `tools/fetch-cleveland.cjs` | Indian and Southeast Asian art (Chola bronzes, Pahari and Mughal painting), plus Japan, China and Korea |

## How it uses AI

All the AI work happens when the site is built, not while you play, so the site is static,
instant and free to host.

1. **Writer:** for each artwork, a vision model (Azure OpenAI GPT-4.1) is shown the image plus the
   museum's catalog facts, and writes a 2–3 sentence note in a witty-friend voice.
2. **Fact-checker:** a second pass with the same model looks at the image and the note again,
   removes or softens anything speculative or not clearly visible, and keeps the jokes.

Quiz questions are built from the catalog data. Wrong answers are real artists from the same era,
countries from the same region, or nearby centuries. "When" questions are skipped for works made over
more than one century, so there's always exactly one right answer.

## Build

```bash
node tools/fetch-aic.cjs && node tools/fetch-rijks.cjs && node tools/fetch-pool.cjs && node tools/fetch-cleveland.cjs
node tools/fetch-hits.cjs
node tools/build-quiz.cjs --reselect --no-notes   # choose the pool (region quotas, famous works first) -> tools/pool.json
node tools/fetch-images.cjs                       # download + shrink pool images into docs/img
export AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... AZURE_OPENAI_DEPLOYMENT=gpt-4.1
node tools/build-quiz.cjs                         # write notes for new works
node tools/fact-check.cjs                         # check them
node tools/build-quiz.cjs                         # rebuild docs/quiz.json with the checked notes
```

Everything already live in `docs/quiz.json` stays in the pool on a reselect, so notes are never thrown away.
