# Sortezy

A water sort puzzle for [bgameworld.com](https://bgameworld.com), alongside the Wordezy games and When & Where.

Pour coloured water between glass tubes until every tube holds a single colour. You can only pour onto the same colour or into an empty tube, and a pour moves as much of the top colour as fits.

- **Daily**: free, one puzzle a day with 9 colours and 11 tubes, the same for every player (generated from the date). There's a move target for three stars. The clock starts when the player presses Play and survives a reload, and a finished puzzle can't be replayed. Undo and restart are free; a hint shows the best next pour and adds 10 seconds. Results share as a spoiler-free summary.
- **Levels**: numbered levels that grow from 3 colours to 12, the same for every player. Levels 1–20 are free; the rest sit behind a one-time $2 unlock, which is a stub until payments are set up. Stars are kept per level.
- **Leaderboard**: same Supabase project and account system as the Wordezy games. Ranked by fewest pours, then time. Only a player's first finish each day counts.
- **Symbols**: an optional symbol on each colour, for players who find some colours hard to tell apart.
- **Achievements, streaks, best time**: stored on the device.

Every puzzle is checked solvable by a built-in solver before it's shown. The same solver sets the move target (usually within 0–2 pours of the true minimum) and powers hints.

## Run it locally

```bash
npm install
cp .env.example .env.local   # same Supabase URL and anon key as the Wordezy games
npm run dev
```

## Database

The leaderboard needs `supabase/migrations/20261008_sortezy.sql`. Run it once in the Supabase SQL editor for the Wordezy project. It only creates new `sortezy_*` objects and is safe to run twice. Until it's run, the game still works and the leaderboard stays hidden.

## Deploy (Cloudflare)

Same setup as the Wordezy games:

1. Push this repo to GitHub.
2. In Cloudflare, create a Worker from the repo. Build command `npm run build`, deploy command `npx wrangler deploy` (see `wrangler.jsonc`).
3. Optional: the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables. Without them the game uses the shared bgameworld project (its URL and publishable key are built in), and if Supabase can't be reached at all the game still plays offline.
4. Add the custom domain `sortezy.bgameworld.com`.
5. In Google Search Console, submit `https://sortezy.bgameworld.com/sitemap.xml`.

## SEO

`index.html` has the title and description, canonical URL, Open Graph and X/Twitter cards with `public/og-image.jpg`, `VideoGame` structured data, a `<noscript>` description, icons and a web manifest. `public/robots.txt` and `public/sitemap.xml` point at the subdomain.

## Changing difficulty

`src/lib/sort.ts` holds the rules, solver and generator. `colorsForLevel` sets the difficulty curve, `DAILY_COLORS` the daily size, and `FREE_LEVELS` how many levels are free. Changing the generator changes every level and future daily puzzle, so avoid it mid-day once the game is live.
