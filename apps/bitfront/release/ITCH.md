# Shipping Bitfront on itch.io

Everything needed for the page is in this folder. The two things I can't do
for you are the two that need your account: **signing in** and **pressing
publish**. The rest is written out below so it's a copy-paste job.

## 1. The build

The uploadable zip is nine files, 55 KB, with `index.html` at the root —
which is what itch's HTML5 player requires. It deliberately leaves out the
README, the design docs and the dev scripts. That zip is the whole game: no
build step, no bundler, no backend.

Rebuild it any time from the `apps/bitfront` folder:

```bash
powershell -Command "Compress-Archive -Force -CompressionLevel Optimal -DestinationPath bitfront-web.zip -Path index.html,styles.css,sprites.js,data.js,game.js,manifest.json,sw.js,icon-192.png,icon-512.png"
```

Adding a file to the game means adding it to that list *and* to `SHELL` in
`sw.js`, or it will be missing offline.

## 2. Page settings

| Field | Value |
| --- | --- |
| Title | `Bitfront` |
| Tagline | `Hold the pass. Pixel by pixel.` |
| Classification | Game |
| Kind of project | HTML |
| Release status | Released |
| Pricing | **No payments**, with donations enabled |
| Uploads | `bitfront-web.zip`, ticked as **"This file will be played in the browser"** |
| Viewport | `1280 x 800` |
| Fullscreen button | on |
| Mobile friendly | on, **landscape only** |
| Automatically start on page load | on |
| Genre | Strategy |
| Tags | `tower-defense`, `rts`, `pixel-art`, `strategy`, `singleplayer`, `html5`, `no-download`, `daily` |
| Community | Comments |

Pricing note: free-with-donations is deliberate. MONETIZATION.md's argument
is that a paywall multiplies against an audience you don't have yet, so the
first version's job is to find out whether anyone comes back on day two.

## 3. Page description

Paste this into the description box (itch takes markdown):

---

**Hold Ironrun Pass for twenty waves.**

Bitfront is a pixel-art tower defence with three systems borrowed from RTS
rather than from tower defence, each one there to make a placement decision
matter:

- **Power fields.** Nothing gets built outside a reactor's field, and every
  reactor costs 20 minerals more than the last one. Ground is finite — you
  can't carpet the map, you have to choose which corner of it you're
  actually defending.
- **An economy with a choice in it.** Extractors go on the crystal seams and
  pay out over time. Calling a wave in early converts the seconds you didn't
  use into minerals, so greed is a real, costed option.
- **Units.** A barracks trains marines who physically stand in the road. A
  creep that walks into one stops walking and fights it. Park them in a
  choke under your guns and you can stall a whole wave.

The matchups are the other half: siege cannons splash hard but can't touch
air, gun turrets hit anything but bounce off brute armour, cryo emitters
barely scratch anything and make everything else work, tesla coils want a
crowd.

**A new run every day.** The Daily Challenge is one seeded run — same map,
same two modifiers, for everybody, derived from the date. Modifiers change
what you *build*, not just how big the numbers get: NO RESERVES takes
barracks off the table, GRID STRAIN doubles the reactor ramp so you defend
one choke instead of three, FOG OF WAR removes the range circles. Play every
day to build a streak, and paste your result anywhere.

Two maps. Twenty named waves, from FIRST PROBE to KRUUG AND VOSK. No
account, no download, no ads — it runs in the tab and it runs offline.

**Controls** — `1`-`7` build · click to place · right-click to rally your
marines · `U`/`S` upgrade and sell · `N` calls the next wave in early for a
bonus · `F` fast-forward · `SPACE` pause · `H` field manual.

On a phone: press to aim, slide to adjust, lift to place, hold for the
right-click. Landscape.

---

## 4. Screenshots

In `release/screenshots/`, all 1600x900, captured from real runs:

| File | What it shows |
| --- | --- |
| `01-menu.png` | menu, daily challenge panel, map picker |
| `02-wave-11.png` | mid-game: marines holding the gate under four turrets |
| `03-base-held.png` | the victory screen after a 20-wave clear |

itch wants a **cover image at 630x500** and I have not made one — none of the
screenshots crop to that ratio without losing the HUD. That's the one asset
still missing before the page looks finished.

## 5. Order of operations

1. Log in at itch.io → **Dashboard → Create new project**.
2. Fill in the table from §2, paste §3 into the description.
3. Upload `bitfront-web.zip`, tick "played in the browser", set the viewport.
4. Upload the three screenshots, and a cover image once one exists.
5. Save as **draft** first and play it in the itch player — the service
   worker and the Google font both behave differently over itch's HTTPS
   iframe than they do off `file://`, and it's worth seeing it work once
   before anyone else does.
6. Set to **Public**, then post it to r/WebGames and r/TowerDefense.

## 6. Known things a player might hit

- The game asks for 384 logical pixels of width. Below that (small phones in
  landscape) it scales fractionally, so the pixels go slightly soft. This is
  deliberate — see the README — but it's the first thing anyone will
  mention.
- There is no save/resume. A run is about ten minutes; closing the tab
  mid-run loses it. Best waves, daily scores and the streak do persist.
- Audio starts on the first interaction, per browser autoplay rules.
