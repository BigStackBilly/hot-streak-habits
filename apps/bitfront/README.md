# Bitfront

A pixel-art RTS tower defence for the browser. Hold the pass for 20 waves:
build a power grid, mine minerals, put turrets and marines in the way of
everything walking down the road at your Command Center. Two maps, picked
from the menu.

Same house rules as the other apps here — no build step, no backend, no
login. Open `index.html` and it works.

## Running it

Double-click `index.html`, or serve the folder and open it:

```bash
npx --yes http-server apps -p 5530 -c-1
```

then go to `http://localhost:5530/bitfront/`. Serving it over http (rather
than `file://`) is only needed for the service worker and "Add to Home
Screen"; the game itself runs fine off the raw file.

## Why it's an RTS and not just a tower defence

Three systems are lifted from StarCraft/Warcraft rather than from tower
defence, and each one exists to make a placement decision interesting:

- **Power fields.** Nothing can be built outside a reactor's field (the HQ
  projects one to get you started). Reactors get **20 minerals more
  expensive for every one already standing**, so ground is finite. Without
  that scaling, the optimal play is to carpet the map — an automated
  playtest that bought a turret whenever it could afford one ended with 101
  of them, which is not a game.
- **Economy.** Extractors go on the violet crystal patches and pay out over
  time. Calling a wave in early converts the unused prep seconds straight
  into minerals, so greed is a real, costed option.
- **Units.** A barracks trains three marines who physically stop ground
  creeps — a creep that walks into one stops walking and fights it.
  Right-click sets the rally flag, so you can park them in a choke and stall
  a whole wave under your guns.

The matchups are the other half of it: siege cannons splash hard but can't
touch air, gun turrets hit anything but bounce off brute armour, cryo
emitters barely scratch anything and make everything else work, tesla coils
want a crowd.

## File structure

```
index.html        page shell + the HUD markup, loads the three scripts
styles.css        the console frame around the game (riveted-panel HUD)
sprites.js        every pixel of art, generated at load time — no images
data.js           the maps, all 20 waves, and every balance number
game.js           simulation, rendering, input, HUD, audio
validate-maps.js  checks every map against the rules the engine assumes
playtest.js       scripted bot that plays full runs, for balance regressions
manifest.json     PWA metadata so phones can install it
sw.js             service worker: caches the shell, runs offline
generate-icons.js writes the PNG icons from a 16x16 drawing (node, no deps)
sync-www.js       assembles www/ for the native build, shell files only
capacitor.config.json  native shell config (appId still needs confirming)
MONETIZATION.md   proposal: how this might make money, and in what order
icon-*.png        app icons, produced by that script

release/          shipping: itch.io page copy, store metadata, screenshots,
                  privacy + support pages, and check-metadata.js
ci/               a GitHub workflow, parked rather than installed — the
                  root .github/ is outside this app's folder
```

Nothing here has a build step or a dependency. `npm install` is only needed
if you go as far as generating the native projects; every script in the list
above runs on a bare `node`.

`sprites.js`, `data.js` and `game.js` are plain classic scripts loaded in
dependency order. They're separate files (rather than inlined like the React
apps in this repo) because there's no JSX here — nothing needs an in-browser
transformer, and classic scripts load fine over `file://`.

## How the art works

There are no image assets. Every sprite is drawn one pixel at a time into a
small offscreen canvas at load, in two styles depending on the shape:

- **Primitives** (`rect`, `frame`, `disc`, `bolt`, `dither`) for the
  mechanical things — turret pads, the Command Center, the extractor.
- **String art** — rows of palette letters like `"..kRRk.."` — for the
  creatures, where a shape is easier to see than to describe.

Everything shares one 26-colour palette keyed by single characters, and one
near-black outline colour, which is what makes the sprites look like one
game rather than a pile of assets.

The whole game renders into a **384x208** buffer that's upscaled by a whole
number (fractional upscaling is what makes pixel games look like mud) with
image smoothing off. The one exception is a screen too small to fit the
buffer at 1x at all — see Controls. Because the buffer is genuinely low-resolution, things
that would normally break the pixel look — rotating turret barrels, arcing
shells, expanding explosion rings — end up chunky and on-grid for free.

Floating combat text uses a hand-rolled 3x5 bitmap font, because the
browser's font rasteriser at this resolution produces grey mush.

## Maps

A map is pure data in `data.js` — a road as waypoints, where the HQ sits,
where the scenery is. Which tiles are road, what's buildable, where creeps
walk and how the ground is painted are all *derived* from that at load, so
the painted road and the "can't build here" rule can never disagree.

| | Ironrun Pass | Coldgate |
| --- | --- | --- |
| road | 45 tiles, enters west | 51 tiles, enters east |
| mineral patches | 5 | 4 |
| rock | 5 | 18 |
| buildable ground in turret range of the road | 193 tiles | 179 |

Coldgate is meant to be the kinder of the two, and the blurb in-game says
so: the extra six tiles of road buy more seconds under fire than the extra
rock and the missing fifth patch take away. Measured over 12 seeded bot runs
per map (see Balance notes) the difference is real but **thin** — both maps
give a median of 19 waves cleared, and the only run that held the pass was
on Coldgate. It needs 26 buildings there against 36 on Ironrun, which is the
clearer tell: Coldgate asks for less to reach the same place.

Best-wave records are kept per map, since surviving to wave 14 on Coldgate
says nothing about your Ironrun run.

Adding a third map is a data change — the picker builds itself from `MAPS`,
and the spawn gatepost is drawn from whichever edge the first waypoint sits
off. Run the validator afterwards:

```bash
node validate-maps.js
```

It re-runs `data.js` in a sandbox and checks the things the engine quietly
assumes but never complains about: axis-aligned road segments, a spawn that
starts offscreen, an HQ that the final waypoint actually touches, nothing
built on top of the road, and enough buildable ground near it to defend.
Break one and the game doesn't throw — it just misbehaves somewhere tedious
to find.

## Flavour

The game plays the same without any of this, but a tower defence where
nothing ever speaks is a spreadsheet with explosions:

- **Comms channel** (bottom-left of the map) — short lines from whoever is
  sitting in the Command Center, fired by real events: what you just built,
  a wave arriving by name, a leak, a marine down, the grid dropping when you
  sell a reactor. Lines live in `COMMS` in `data.js`, several variants each,
  with `{tokens}` filled in at runtime. Guards against it turning into noise:
  four lines maximum, each expiring on its own timer, the same line never
  repeats back to back, and burst-prone events (marines dying) carry a
  per-event cooldown.
- **Named waves** — all 20, from FIRST PROBE to KRUUG AND VOSK. Shown in the
  banner, the comms line and the next-wave preview.
- **Building quips** — one line of the building's own opinion of itself in
  the inspector, which doubles as a reminder of what it's for ("Point it at
  the ground, never at the sky").
- **Idle life** — crows crossing the pass every 20-30 seconds, a radar sweep
  and beacon on the HQ, power pulsing off the reactors, unclaimed mineral
  patches twinkling. All render-time, no gameplay effect.

The comms panel is DOM overlaid on the canvas rather than drawn into it:
384x208 is no place for prose. It thins itself to two lines when the map is
scaled small, so chatter never covers the road.

## Daily Challenge, score and streak

A run ends with a **number** now — waves cleared dominate, HP left is the
tiebreaker that rewards not leaking, kills add a little, hoarded minerals add
almost nothing, leaks subtract. Each active modifier adds 8%, so a hard run
scores higher than an easy one.

That score exists to make the **Daily Challenge** worth playing: one seeded
run a day — same map, same two modifiers, for everybody — derived from the
date with `mulberry32`, so there is no server, no account and no leaderboard
to host. First attempt scores; replays are allowed but don't overwrite it,
because losing your whole day to one misclick is miserable. Consecutive days
build a **streak**, which is the actual retention mechanic.

Eight **modifiers** live in `MODIFIERS` in `data.js`, each a small bundle of
multipliers the simulation reads at the point of use — a modifier is data,
never a branch in the engine. The design rule is that a modifier has to
change what you *build*, not just how big the numbers are: NO RESERVES takes
barracks off the table entirely, GRID STRAIN doubles reactor cost scaling so
you defend one choke instead of three, FOG OF WAR removes the range circles.

Results copy as a Wordle-style share card. See `MONETIZATION.md` for why
that's the most valuable feature in this list.

## Balance notes

Enemy HP follows one curve (`hpScale` in `data.js`) rather than per-wave
numbers, so difficulty is one line to re-tune. Bounties grow much more
slowly than HP — that squeeze is what forces extractors early instead of
coasting on kill income.

The numbers were tuned against a scripted bot that plays the whole run
(places turrets to maximise road coverage, buys extractors, upgrades when it
runs out of ground). That bot is in the repo, so the claim below is one you
can re-run rather than one you have to take on faith:

```bash
node playtest.js --runs 12
```

It opens the real `game.js` in a stub DOM, seeds `Math.random` so a run is
reproducible, and fails with a non-zero exit if either map falls outside the
band in `EXPECT`. With the current tables, over 12 seeds per map: a **median
of 19 waves cleared on both maps**, one run in 24 holding the pass, and
almost every loss happening on wave 20 itself.

That last part is the thing to know about this game's difficulty: **wave 20
is a cliff, not a slope.** The bot reaches KRUUG AND VOSK nearly every time
and then dies to it, with a spread of one or two waves across a dozen seeds.
Whether that's a good final exam or a wall that wants sanding down is a
design call, not a bug — but it means "how hard is Bitfront" is really the
question "how hard is the last wave".

The bot is a floor, not a target: it never calls a wave early, never sells,
and never re-sites a turret. A human using those three should beat it.

Air waves (wave 6, 12, 17, 19) deserve a note: flyers **cut every other
corner** off the road rather than beelining for the HQ. The beeline version
was implemented first and was strictly worse — an air wave was an
unavoidable loss if your guns happened to be on the wrong side of the map,
which punishes sensible play rather than testing it.

## Controls

| Key | Action |
| --- | --- |
| `1`-`7` | pick a building |
| click | place it / select a placed building |
| right-click | cancel the build tool, or set the marine rally flag |
| `SHIFT` | hold to stay in build mode after placing |
| `U` / `S` | upgrade / sell the selected building |
| `N` | send the next wave early (pays a bonus) |
| `F` | fast-forward 2x |
| `SPACE` | pause |
| `H` | field manual |

On touch, a finger isn't a mouse, so it isn't just "tap = click":

| Gesture | Action |
| --- | --- |
| press | show the ghost under your finger — nothing is committed yet |
| slide | move it; a fingertip covers about eight tiles, you need to aim |
| lift | place / select, at the tile you can actually see |
| hold (450ms) | the right-click: drop the rally flag, or cancel the build tool |

Committing on touch*end* rather than touch*start* is what makes the preview
and the long press possible, and it means a mistap can be slid off before it
costs you 120 minerals.

The map is drawn at 384px wide, which doesn't fit a 375px phone, so below 1x
the canvas scales fractionally rather than clamping to 1x — a slightly soft
map you can see all of beats a crisp one whose right-hand columns are off the
edge of the screen. It's still a mouse-and-keyboard game at heart.

## Persistence

All local, no accounts: best wave **per map**, the daily challenge's scores
and streak, the last map you picked, and the mute setting. There's no
save/resume mid-run — a run is about 10 minutes.
