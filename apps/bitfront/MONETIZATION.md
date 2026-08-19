# Bitfront — making money, and making people come back

Written as a proposal, not a plan of record. Nothing in the "money" half is
built; the retention half is, because it has to come first.

## The honest bit first

A browser tower defence with no audience makes approximately nothing,
whatever you bolt onto it. Ads, IAP, paid-upfront — all of them multiply
against a player count, and right now that number is zero. So the order that
actually matters is:

1. **Retention** — a reason to open it tomorrow. (Built. See below.)
2. **Distribution** — somewhere players can find it.
3. **Monetization** — only worth wiring once 1 and 2 exist.

Doing 3 first is how you end up with an IAP nobody sees.

## What's already built (free, no backend)

- **Score.** Every run ends with a number: waves cleared dominate, HP left is
  the tiebreaker, leaks cost you, hoarded minerals barely count. A run is now
  something to beat rather than a pass/fail.
- **Daily Challenge.** One seeded run a day — same map, same two modifiers,
  for everybody, derived from the date with no server involved. First attempt
  scores; replays are allowed but don't overwrite it (losing a day to one
  misclick is miserable).
- **Streak.** Consecutive days played. This is the actual retention engine —
  the same mechanic as the habit tracker this repo is named after.
- **Modifiers.** Eight of them, each one changing what you *build* rather than
  just how big the numbers are: no barracks at all, doubled reactor scaling,
  8-second prep, no range circles.
- **Share card.** Wordle-style pasteable result. This is free distribution and
  the only marketing the game has.

## Monetization, ranked by return per unit of effort

### 1. One-time "Command Pack" unlock — the recommendation

Matches the house pattern already in `brobots` (`*.pro.v1` in localStorage,
$1.99–$3.99). Free game, one optional purchase, no subscription, no ads.

What goes behind it — **variety, never power**:

| Include | Why |
| --- | --- |
| Endless mode | The natural "I want more" after wave 20 |
| 3–4 extra maps | Cheap to author now the map format is data + validated |
| Faction skins | `PAL` is one table; a recolour is ~30 lines for a visibly different army |
| Run archive + per-modifier bests | Rewards the people already playing daily |

What must stay free: **the Daily Challenge and both current maps.** The daily
is the retention engine and the shop window — gating it kills the funnel and
makes the streak worthless.

What must never go in: extra damage, more starting minerals, "continue after
losing". Single-player pay-to-win reads as contempt and shows up in reviews.

Effort: the paywall UI is an afternoon. **Real** IAP is the expensive part —
nothing in this repo has actual StoreKit/Play Billing wired; every app's
"Pro" is currently an honour-system localStorage flag. That's a Capacitor
purchase plugin plus store product config per platform.

### 2. Web build as a free funnel — do this regardless

itch.io costs nothing, indexes well, and supports pay-what-you-want plus a
tip jar. Same for posting to r/WebGames / r/incremental_games. This is where
players come from; the native builds are where they'd pay.

### 3. Ads — recommended against

At this scale it's pennies a month, and the costs are real: an SDK in every
build, a privacy policy rewrite, App Store data-disclosure answers, and worse
load times on a game whose whole pitch is "opens instantly". A rewarded
"revive after losing" would also wreck the daily score's integrity.

### 4. Loot boxes / gacha — actively harmful here

Beyond being a bad fit for a 10-minute TD: `lootBox` and `gamblingSimulated`
are literally two of the age-rating attributes currently blocking every iOS
submission in this repo. Adding one buys a harder review for less money.

## What I'd do in order

1. Ship the game free on itch.io with the daily challenge and the share card.
2. Watch whether anyone comes back on day 2 and day 7. If they don't, no
   paywall will help and the answer is a better game, not a better funnel.
3. If retention holds, author the extra maps and skins, then wire one real
   IAP — once, properly, in a way the other 20 apps can reuse.
