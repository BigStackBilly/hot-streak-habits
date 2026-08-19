// =====================================================================
// BLADERUN — a fast, single-lane hack-and-slash runner
//
// Plain JS, no framework — a deliberate departure from the React+Babel
// pattern most sibling apps in this portfolio use (see ironlog/wordday).
// That pattern fits form-driven apps well, but this is a real-time game
// loop mutating the DOM every frame; a virtual-DOM re-render per frame
// would just be wasted work. Same reasoning as the Veer/Swerve sibling
// game project.
//
// Organized top to bottom as:
//   1. Constants & storage keys
//   2. localStorage helpers (runs, best score, gold, upgrades, pass)
//   3. Runs/regen math (identical model to Veer's lives system)
//   4. Upgrade catalog (cost curves, effective stats)
//   5. DOM refs
//   6. Game loop (spawn, move, slash, damage)
//   7. UI rendering (overlays, shop)
//   8. Input handling & wiring
// =====================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------
  // 1. Constants & storage keys
  // ---------------------------------------------------------------

  const MAX_RUNS = 5;
  const REGEN_MS = 20 * 60 * 1000; // one run every 20 minutes
  const BASE_HEARTS = 3;

  const BASE_MINION_SPEED = 140; // px/sec at run start
  const MAX_MINION_SPEED = 380;
  const SPEED_RAMP_PER_SEC = 6;
  const BASE_SPAWN_MS = 1200;
  const MIN_SPAWN_MS = 450;
  const SPAWN_RAMP_PER_SEC = 6;
  const HP_RAMP_SEC = 25; // every this many seconds survived, minion base HP goes up
  const MAX_MINION_HP = 4;
  const SLASH_COOLDOWN_MS = 170;
  const COMBO_BONUS_PER_STEP = 0.1;
  const COMBO_CAP_MULT = 3;
  const KILL_BASE_SCORE = 10;
  const PARTICLE_COUNT = 10;

  const RUNS_KEY = "bladerun.runs.v1";
  const BEST_KEY = "bladerun.best.v1";
  const GOLD_KEY = "bladerun.gold.v1";
  const UPGRADES_KEY = "bladerun.upgrades.v1";
  const PASS_KEY = "bladerun.pass.v1";

  // ---------------------------------------------------------------
  // 2. localStorage helpers
  // ---------------------------------------------------------------

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadRuns() {
    return loadJSON(RUNS_KEY, { runs: MAX_RUNS, regenAt: null });
  }

  function saveRuns(state) {
    saveJSON(RUNS_KEY, state);
  }

  function loadBest() {
    return Number(localStorage.getItem(BEST_KEY) || 0);
  }

  function saveBest(score) {
    localStorage.setItem(BEST_KEY, String(score));
  }

  function loadGold() {
    return Number(localStorage.getItem(GOLD_KEY) || 0);
  }

  function saveGold(amount) {
    localStorage.setItem(GOLD_KEY, String(Math.max(0, amount)));
  }

  function loadUpgrades() {
    return loadJSON(UPGRADES_KEY, { blade: 0, hearts: 0, goldMult: 0 });
  }

  function saveUpgrades(u) {
    saveJSON(UPGRADES_KEY, u);
  }

  function loadPass() {
    return loadJSON(PASS_KEY, { unlimitedUntil: null });
  }

  function savePass(p) {
    saveJSON(PASS_KEY, p);
  }

  // ---------------------------------------------------------------
  // 3. Runs/regen math (same model as Veer's lives system: derive the
  //    current count fresh from a timestamp rather than ticking a
  //    stored number down in real time, so it's correct however long
  //    the app was closed)
  // ---------------------------------------------------------------

  function reconcileRuns(state, now) {
    now = now || Date.now();
    while (state.runs < MAX_RUNS && state.regenAt && now >= state.regenAt) {
      state.runs += 1;
      state.regenAt = state.runs < MAX_RUNS ? state.regenAt + REGEN_MS : null;
    }
    if (state.runs < MAX_RUNS && !state.regenAt) {
      state.regenAt = now + REGEN_MS;
    }
    if (state.runs >= MAX_RUNS) {
      state.regenAt = null;
    }
    return state;
  }

  function hasUnlimitedPass() {
    const pass = loadPass();
    return !!pass.unlimitedUntil && Date.now() < pass.unlimitedUntil;
  }

  function endOfTodayTimestamp() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  function consumeRun() {
    if (hasUnlimitedPass()) return;
    let state = reconcileRuns(loadRuns());
    state.runs = Math.max(0, state.runs - 1);
    if (!state.regenAt && state.runs < MAX_RUNS) {
      state.regenAt = Date.now() + REGEN_MS;
    }
    saveRuns(state);
  }

  function canPlay() {
    if (hasUnlimitedPass()) return true;
    const state = reconcileRuns(loadRuns());
    saveRuns(state);
    return state.runs > 0;
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ---------------------------------------------------------------
  // 4. Upgrade catalog
  // ---------------------------------------------------------------

  const UPGRADES = {
    blade: { name: "Blade Damage", icon: "🗡️", maxLevel: 5, baseCost: 20, desc: (lvl) => `+${lvl} dmg/hit` },
    hearts: { name: "Max Hearts", icon: "❤️", maxLevel: 2, baseCost: 60, desc: (lvl) => `+${lvl} starting heart${lvl === 1 ? "" : "s"}` },
    goldMult: { name: "Gold Find", icon: "🪙", maxLevel: 6, baseCost: 30, desc: (lvl) => `+${lvl * 25}% gold/kill` },
  };

  function upgradeCost(key, level) {
    return Math.round(UPGRADES[key].baseCost * Math.pow(level + 1, 1.6));
  }

  function bladeDamage() {
    return 1 + loadUpgrades().blade;
  }

  function startingHearts() {
    return BASE_HEARTS + loadUpgrades().hearts;
  }

  function goldMultiplier() {
    return 1 + loadUpgrades().goldMult * 0.25;
  }

  // ---------------------------------------------------------------
  // 5. DOM refs
  // ---------------------------------------------------------------

  const playfieldEl = document.getElementById("playfield");
  const minionLayerEl = document.getElementById("minionLayer");
  const playerEl = document.getElementById("player");
  const swordEl = document.getElementById("sword");
  const hitFlashEl = document.getElementById("hitFlash");
  const liveScoreEl = document.getElementById("liveScore");
  const comboDisplayEl = document.getElementById("comboDisplay");
  const goldCountEl = document.getElementById("goldCount");
  const runHeartsEl = document.getElementById("runHearts");

  const startOverlay = document.getElementById("startOverlay");
  const gameOverOverlay = document.getElementById("gameOverOverlay");
  const noLivesOverlay = document.getElementById("noLivesOverlay");

  const heartsDisplay = document.getElementById("heartsDisplay");
  const regenTimerEl = document.getElementById("regenTimer");
  const bestScoreDisplay = document.getElementById("bestScoreDisplay");
  const startLivesRow = document.getElementById("startLivesRow");

  const finalScoreDisplay = document.getElementById("finalScoreDisplay");
  const newBestBadge = document.getElementById("newBestBadge");
  const goldEarnedDisplay = document.getElementById("goldEarnedDisplay");
  const noLivesCountdown = document.getElementById("noLivesCountdown");

  const shopModal = document.getElementById("shopModal");
  const shopGoldBalance = document.getElementById("shopGoldBalance");
  const upgradeListEl = document.getElementById("upgradeList");
  const goldPackListEl = document.getElementById("goldPackList");

  // ---------------------------------------------------------------
  // 6. Game loop
  // ---------------------------------------------------------------

  let game = null;

  function playfieldHeight() {
    return playfieldEl.getBoundingClientRect().height;
  }

  function strikeLineY() {
    return playfieldHeight() - 96;
  }

  function currentSpeed() {
    const sec = game.elapsedMs / 1000;
    return Math.min(MAX_MINION_SPEED, BASE_MINION_SPEED + sec * SPEED_RAMP_PER_SEC);
  }

  function currentSpawnInterval() {
    const sec = game.elapsedMs / 1000;
    return Math.max(MIN_SPAWN_MS, BASE_SPAWN_MS - sec * SPAWN_RAMP_PER_SEC);
  }

  function currentMinionMaxHp() {
    const sec = game.elapsedMs / 1000;
    return Math.min(MAX_MINION_HP, 1 + Math.floor(sec / HP_RAMP_SEC));
  }

  function startGame() {
    if (!canPlay()) {
      showNoLives();
      return;
    }

    hideAllOverlays();
    minionLayerEl.innerHTML = "";

    game = {
      minions: [],
      lastSpawn: 0,
      lastTimestamp: null,
      lastSlashAt: -9999,
      elapsedMs: 0,
      score: 0,
      kills: 0,
      combo: 0,
      goldEarned: 0,
      hearts: startingHearts(),
      maxHearts: startingHearts(),
      over: false,
    };

    refreshRunHUD();
    requestAnimationFrame(loop);
  }

  function spawnMinion() {
    const maxHp = currentMinionMaxHp();
    const hp = 1 + Math.floor(Math.random() * maxHp);
    const tier = hp >= 3 ? "brute" : hp === 2 ? "grunt2" : "grunt";

    const el = document.createElement("div");
    el.className = `minion ${tier}`;
    el.style.top = "-60px";

    const body = document.createElement("div");
    body.className = "minion-body";
    el.appendChild(body);

    minionLayerEl.appendChild(el);
    game.minions.push({ el, hp, maxHp: hp, y: -60 });
  }

  function loop(timestamp) {
    if (!game || game.over) return;

    if (game.lastTimestamp == null) game.lastTimestamp = timestamp;
    const dt = Math.min(48, timestamp - game.lastTimestamp);
    game.lastTimestamp = timestamp;
    game.elapsedMs += dt;

    if (game.elapsedMs - game.lastSpawn >= currentSpawnInterval()) {
      game.lastSpawn = game.elapsedMs;
      spawnMinion();
    }

    const dy = (currentSpeed() * dt) / 1000;
    const line = strikeLineY();

    for (let i = game.minions.length - 1; i >= 0; i--) {
      const m = game.minions[i];
      m.y += dy;
      m.el.style.top = `${m.y}px`;

      if (m.y >= line) {
        m.el.remove();
        game.minions.splice(i, 1);
        loseHeart();
        if (game.over) return;
      }
    }

    requestAnimationFrame(loop);
  }

  function nearestMinion() {
    if (!game.minions.length) return null;
    let best = game.minions[0];
    for (const m of game.minions) if (m.y > best.y) best = m;
    return best;
  }

  function swingSword() {
    swordEl.classList.remove("swinging");
    void swordEl.offsetWidth;
    swordEl.classList.add("swinging");
  }

  function slash() {
    if (!game || game.over) return;
    if (game.elapsedMs - game.lastSlashAt < SLASH_COOLDOWN_MS) return;
    game.lastSlashAt = game.elapsedMs;

    swingSword();

    const target = nearestMinion();
    if (!target) return;

    target.hp -= bladeDamage();
    spawnHitSparks(target);

    if (target.hp <= 0) {
      killMinion(target);
    } else {
      target.el.classList.remove("hurt");
      void target.el.offsetWidth;
      target.el.classList.add("hurt");
    }
  }

  function killMinion(minion) {
    const idx = game.minions.indexOf(minion);
    if (idx >= 0) game.minions.splice(idx, 1);

    spawnDeathBurst(minion);
    minion.el.remove();

    game.kills += 1;
    game.combo += 1;

    const comboMult = Math.min(COMBO_CAP_MULT, 1 + game.combo * COMBO_BONUS_PER_STEP);
    const points = Math.round(KILL_BASE_SCORE * comboMult);
    game.score += points;
    liveScoreEl.textContent = String(game.score);
    liveScoreEl.classList.remove("pop");
    void liveScoreEl.offsetWidth;
    liveScoreEl.classList.add("pop");

    const goldGain = Math.max(1, Math.round(1 * goldMultiplier()));
    game.goldEarned += goldGain;
    saveGold(loadGold() + goldGain);
    goldCountEl.textContent = String(loadGold());

    refreshComboUI();
  }

  function refreshComboUI() {
    if (game.combo > 1) {
      const mult = Math.min(COMBO_CAP_MULT, 1 + game.combo * COMBO_BONUS_PER_STEP);
      comboDisplayEl.textContent = `x${mult.toFixed(1)} COMBO`;
      comboDisplayEl.classList.remove("hidden");
      comboDisplayEl.classList.remove("pop");
      void comboDisplayEl.offsetWidth;
      comboDisplayEl.classList.add("pop");
    } else {
      comboDisplayEl.classList.add("hidden");
    }
  }

  function spawnHitSparks(minion) {
    const rect = minion.el.getBoundingClientRect();
    const fieldRect = playfieldEl.getBoundingClientRect();
    spawnParticles(rect.left - fieldRect.left + rect.width / 2, rect.top - fieldRect.top + rect.height / 2, ["#fff6c8", "#ffd12e"], 6, 30);
  }

  function spawnDeathBurst(minion) {
    const rect = minion.el.getBoundingClientRect();
    const fieldRect = playfieldEl.getBoundingClientRect();
    const colors = minion.maxHp >= 3 ? ["#ff5a2e", "#ff2d2d"] : ["#7bff6a", "#2ecc71"];
    spawnParticles(rect.left - fieldRect.left + rect.width / 2, rect.top - fieldRect.top + rect.height / 2, colors, PARTICLE_COUNT, 55);
  }

  function spawnParticles(cx, cy, colors, count, maxDist) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = maxDist * 0.4 + Math.random() * maxDist * 0.6;
      const p = document.createElement("div");
      p.className = "particle";
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--particle-color", colors[i % colors.length]);
      minionLayerEl.appendChild(p);
      setTimeout(() => p.remove(), 480);
    }
  }

  function loseHeart() {
    game.combo = 0;
    refreshComboUI();
    game.hearts = Math.max(0, game.hearts - 1);
    triggerHitEffects();
    refreshRunHUD();

    if (game.hearts <= 0) {
      endGame();
    }
  }

  function triggerHitEffects() {
    playfieldEl.classList.remove("shake");
    void playfieldEl.offsetWidth;
    playfieldEl.classList.add("shake");
    setTimeout(() => playfieldEl.classList.remove("shake"), 320);

    hitFlashEl.classList.remove("flash");
    void hitFlashEl.offsetWidth;
    hitFlashEl.classList.add("flash");

    playerEl.classList.remove("hit");
    void playerEl.offsetWidth;
    playerEl.classList.add("hit");
    setTimeout(() => playerEl.classList.remove("hit"), 350);
  }

  function endGame() {
    game.over = true;
    consumeRun();

    const best = loadBest();
    const isNewBest = game.score > best;
    if (isNewBest) saveBest(game.score);

    setTimeout(() => showGameOver(game.score, game.goldEarned, isNewBest), 240);
  }

  // ---------------------------------------------------------------
  // 7. UI rendering
  // ---------------------------------------------------------------

  function hideAllOverlays() {
    startOverlay.classList.add("hidden");
    gameOverOverlay.classList.add("hidden");
    noLivesOverlay.classList.add("hidden");
  }

  function renderHearts(container, current, max) {
    container.innerHTML = "";
    for (let i = 0; i < max; i++) {
      const span = document.createElement("span");
      span.className = "heart" + (i < current ? "" : " empty");
      span.textContent = i < current ? "❤️" : "🖤";
      container.appendChild(span);
    }
  }

  function refreshRunHUD() {
    if (game) renderHearts(runHeartsEl, game.hearts, game.maxHearts);
    goldCountEl.textContent = String(loadGold());
  }

  let regenInterval = null;

  function refreshLivesUI() {
    const state = reconcileRuns(loadRuns());
    saveRuns(state);

    renderHearts(heartsDisplay, state.runs, MAX_RUNS);
    renderHearts(startLivesRow, state.runs, MAX_RUNS);
    bestScoreDisplay.textContent = String(loadBest());
    goldCountEl.textContent = String(loadGold());

    const unlimited = hasUnlimitedPass();
    if (unlimited) {
      regenTimerEl.textContent = "∞ unlimited today";
      regenTimerEl.classList.remove("hidden");
    } else if (state.runs < MAX_RUNS && state.regenAt) {
      regenTimerEl.textContent = `next in ${formatCountdown(state.regenAt - Date.now())}`;
      regenTimerEl.classList.remove("hidden");
    } else {
      regenTimerEl.classList.add("hidden");
    }
  }

  function showStart() {
    game = null;
    hideAllOverlays();
    refreshLivesUI();
    startOverlay.classList.remove("hidden");
  }

  function showGameOver(score, goldEarned, isNewBest) {
    hideAllOverlays();
    finalScoreDisplay.textContent = String(score);
    goldEarnedDisplay.textContent = String(goldEarned);
    newBestBadge.classList.toggle("hidden", !isNewBest);
    refreshLivesUI();
    gameOverOverlay.classList.remove("hidden");
  }

  function showNoLives() {
    hideAllOverlays();
    refreshLivesUI();
    noLivesOverlay.classList.remove("hidden");
  }

  function tickNoLivesCountdown() {
    if (noLivesOverlay.classList.contains("hidden")) return;
    const state = reconcileRuns(loadRuns());
    saveRuns(state);
    if (state.runs > 0 || hasUnlimitedPass()) {
      refreshLivesUI();
      noLivesOverlay.classList.add("hidden");
      startOverlay.classList.remove("hidden");
      return;
    }
    noLivesCountdown.textContent = formatCountdown(state.regenAt - Date.now());
  }

  // --- Shop ---

  function renderShop() {
    const gold = loadGold();
    const upgrades = loadUpgrades();
    shopGoldBalance.textContent = String(gold);

    upgradeListEl.innerHTML = "";
    Object.keys(UPGRADES).forEach((key) => {
      const def = UPGRADES[key];
      const level = upgrades[key];
      const maxed = level >= def.maxLevel;
      const cost = maxed ? null : upgradeCost(key, level);

      const row = document.createElement("div");
      row.className = "upgrade-row";
      row.innerHTML = `
        <div class="upgrade-icon">${def.icon}</div>
        <div class="upgrade-info">
          <div class="upgrade-name">${def.name} <span class="upgrade-level">Lv ${level}/${def.maxLevel}</span></div>
          <div class="upgrade-desc">${maxed ? "Maxed out" : def.desc(level + 1)}</div>
        </div>
        <button class="btn ${maxed ? "btn-ghost" : "btn-secondary"} upgrade-btn" ${maxed ? "disabled" : ""}>
          ${maxed ? "MAX" : `🪙 ${cost}`}
        </button>
      `;

      if (!maxed) {
        const btn = row.querySelector(".upgrade-btn");
        btn.disabled = gold < cost;
        btn.addEventListener("click", () => {
          const g = loadGold();
          if (g < cost) return;
          saveGold(g - cost);
          upgrades[key] += 1;
          saveUpgrades(upgrades);
          renderShop();
        });
      }

      upgradeListEl.appendChild(row);
    });

    goldPackListEl.innerHTML = "";
    [
      { id: "small", label: "Small Pack", amount: 50 },
      { id: "medium", label: "Medium Pack", amount: 150 },
      { id: "large", label: "Large Pack", amount: 400 },
    ].forEach((pack) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-primary gold-pack-btn";
      btn.innerHTML = `${pack.label}<span class="gold-pack-amount">+${pack.amount} 🪙</span>`;
      btn.addEventListener("click", () => {
        saveGold(loadGold() + pack.amount);
        renderShop();
      });
      goldPackListEl.appendChild(btn);
    });
  }

  // ---------------------------------------------------------------
  // 8. Input handling & wiring
  // ---------------------------------------------------------------

  document.getElementById("slashZone").addEventListener("click", slash);

  window.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") slash();
  });

  document.getElementById("playBtn").addEventListener("click", startGame);
  document.getElementById("playAgainBtn").addEventListener("click", startGame);
  document.getElementById("backHomeBtn").addEventListener("click", showStart);

  document.getElementById("refillBtn").addEventListener("click", () => {
    saveRuns({ runs: MAX_RUNS, regenAt: null });
    refreshLivesUI();
    showStart();
  });

  document.getElementById("passBtn").addEventListener("click", () => {
    savePass({ unlimitedUntil: endOfTodayTimestamp() });
    refreshLivesUI();
    showStart();
  });

  document.getElementById("closeNoLives").addEventListener("click", showStart);

  function openShop() {
    renderShop();
    shopModal.classList.remove("hidden");
  }
  function closeShop() {
    shopModal.classList.add("hidden");
    refreshLivesUI();
  }
  document.getElementById("shopBtn").addEventListener("click", openShop);
  document.getElementById("openShopFromStart").addEventListener("click", openShop);
  document.getElementById("closeShop").addEventListener("click", closeShop);

  // Countdown ticks (runs pill + out-of-runs screen) once a second
  regenInterval = setInterval(() => {
    refreshLivesUI();
    tickNoLivesCountdown();
  }, 1000);

  // Boot
  showStart();

  window.__brDebug = { getGame: () => game, slash, spawnMinion };
})();
