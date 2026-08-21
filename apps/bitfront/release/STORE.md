# Bitfront — native builds and store metadata

Two halves: the metadata, which is finished and copy-pasteable, and the
native build, which is scaffolded but **not yet wired into this repo's CI**.
See "What is still blocked" at the bottom before planning around this.

## Metadata

Every field below has been checked against the length limit that actually
rejects an upload. The two that have caused real `deliver` failures on this
repo's other apps are marked.

| Field | Limit | Used | Value |
| --- | --- | --- | --- |
| App name | 30 | 8 | `Bitfront` |
| Subtitle **(hard limit)** | 30 | 29 | `Hold the pass, pixel by pixel` |
| Keywords **(hard limit)** | 100 | 84 | `tower defense,RTS,strategy,pixel art,base building,turrets,daily,offline,retro,waves` |
| Promotional text | 170 | 142 | see below |
| Play short description | 80 | 62 | `A pixel-art RTS tower defence. Hold the pass for twenty waves.` |
| Primary category | — | — | Games → Strategy |
| Secondary category | — | — | Games → Action |
| Price | — | — | Free, no in-app purchases |

Re-check these with:

```bash
node release/check-metadata.js
```

**Promotional text**

```
Twenty waves. One road. Build a power grid, mine the seams, and put something in the way before the horn goes. New seeded challenge every day.
```

**Description** (App Store and Play both take this as-is, under 4000 chars)

```
Hold Ironrun Pass for twenty waves.

Bitfront is a pixel-art tower defence built on three ideas borrowed from real-time strategy, each one there to make a placement decision matter.

POWER FIELDS
Nothing can be built outside a reactor's field, and every reactor costs more than the last. Ground is finite. You cannot carpet the map — you have to decide which corner of it you are actually defending.

AN ECONOMY WITH A CHOICE IN IT
Extractors go on the crystal seams and pay out over time. Calling a wave in early converts the seconds you did not use straight into minerals, so greed is a real option with a real price.

MARINES THAT STAND IN THE ROAD
A barracks trains three of them. A creep that walks into a marine stops walking and fights it. Park them in a choke under your guns and you can stall an entire wave.

Then the matchups: siege cannons splash hard but cannot touch air, gun turrets hit anything but bounce off brute armour, cryo emitters barely scratch anything and make everything else work, tesla coils want a crowd.

A NEW RUN EVERY DAY
The Daily Challenge is one seeded run — the same map and the same two modifiers for everybody, worked out from the date itself. The modifiers change what you build rather than just how big the numbers are: NO RESERVES takes barracks off the table, GRID STRAIN doubles the reactor ramp so you defend one choke instead of three, FOG OF WAR takes away the range circles. Play on consecutive days to build a streak.

Two maps. Twenty named waves, from FIRST PROBE to KRUUG AND VOSK. Every sprite drawn a pixel at a time.

No accounts. No ads. No in-app purchases. No tracking of any kind, and nothing is ever sent anywhere — the game works with the network off.
```

## Age rating

Bitfront is the easy case, and it is worth keeping it that way. It has no
chat, no accounts, no purchases, no advertising, no user-generated content,
and — importantly for this repo — **no simulated gambling and no loot
boxes**, which are the two attributes that have caused review friction on
other apps here. Expected outcome:

- App Store: **4+**, cartoon or fantasy violence set to *None* (the creeps
  pop into pixels; there are no depictions of injury)
- Google Play IARC: **Everyone**
- Content rights: no third-party content. Every sprite and sound is generated
  by the code at runtime; there are no licensed assets to declare.

The one asset with any outside provenance is the Press Start 2P web font
(SIL Open Font License), which the **native build does not use** — it falls
back to the system monospace, and the game is designed to look right either
way.

## Required URLs

Both pages are written and in this folder; they just need hosting.

| Page | File | Needed by |
| --- | --- | --- |
| Privacy policy | `release/privacy.html` | App Store, Play, both mandatory |
| Support page | `release/support.html` | App Store (mandatory), Play (recommended) |

Netlify is out of storage on this account, so deploy these to **Vercel** —
drop the `release/` folder in as a static project and the two pages are live
at `/privacy.html` and `/support.html`. Put the resulting URLs in App Store
Connect and Play Console.

## Icons

`AppStoreIcon-1024.png` is already correct and should be left alone: it is
1024x1024, PNG colour type 2, **no alpha channel**. Alpha in that file is
what makes an upload fail and then hangs the submit job for hours. If it is
ever regenerated, zoom-crop to fill the square — never fill the transparency
with a colour, and re-check with:

```bash
node release/check-metadata.js
```

which fails if any icon has an alpha channel.

## The native build

Capacitor is scaffolded but no native project has been generated yet.

```bash
npm install              # pulls @capacitor/core, /cli, /ios, /android
npm run www              # assembles www/ from the nine shell files
npx cap add ios
npx cap add android
npm run sync             # rebuild www/ and push it into both projects
```

`sync-www.js` copies only the shell into `www/` and strips the service worker
registration — inside a native shell the files are already local, and a stale
cache is a support ticket.

Three things to set once the native projects exist:

- **`appId`.** `capacitor.config.json` currently says
  `com.hotstreakhabits.bitfront`. **This is a guess.** Confirm it against the
  scheme the other apps in this repo already use and the Bundle IDs already
  registered in App Store Connect before generating anything, because
  changing it afterwards means a new record.
- **Orientation.** Landscape only, both platforms. The game asks for 384
  logical pixels of width and is unplayable in portrait.
- **iPhone only, or iPhone + iPad?** If the device family is set to iPhone
  only, do **not** upload iPad screenshots — an iPad shot on an iPhone-only
  app makes App Store Connect silently drop the entire screenshot batch.

## Screenshots

`release/screenshots/` holds three 1600x900 captures from real runs. Those
are sized for itch.io, **not** for the stores — Apple and Google both want
specific device resolutions, which means re-capturing at the right sizes
once the device family is decided.

## What is still blocked

**CI.** This repo builds and submits its apps from workflows at the
repository root, and this app was scoped as "don't touch anything outside
`apps/bitfront/`", so nothing has been added there. A ready-to-install
workflow is in `ci/bitfront-checks.yml` — see `ci/README.md`. Wiring the
actual iOS/Android build and submit lanes means editing the shared
workflows and fastlane config at the repo root, which needs a decision
first.

**Store accounts.** Creating app records, uploading builds, and pressing
submit all need account access. None of that can be done from here.

**MONETIZATION.md disagrees with doing this now**, and it makes a fair
point: the web release is free, indexes well, and answers the question of
whether anyone comes back on day two. The native path is the more expensive
half and is worth spending after that answer arrives, not before.
