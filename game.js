'use strict';
/* =========================================================================
   DOODLE SKY — an endless vertical jumper inspired by Doodle Jump.
   Pure canvas 2D, no external libraries. See README.md for full notes.
   ========================================================================= */

/* ---------------------------- constants -------------------------------- */
const LOGICAL_W = 400;
const LOGICAL_H = 650;

const GRAVITY        = 1500;   // px/s^2
const MOVE_ACCEL     = 2400;   // px/s^2
const MAX_MOVE_SPEED = 300;    // px/s
const AIR_FRICTION   = 1900;   // px/s^2 deceleration with no input
const JUMP_VY        = -700;   // normal platform bounce
const SPRING_VY      = -1080;  // spring bounce
const JETPACK_VY     = -560;   // constant climb speed while jetpack active
const JETPACK_TIME   = 2.2;    // seconds
const PROPELLER_TIME = 3.4;    // seconds of slow-fall + extra air control
const PROPELLER_GRAVITY_MULT = 0.35;
const SHIELD_BUMP_VX = 260;

const PLAYER_W = 46, PLAYER_H = 46;
const PLAT_W = 68, PLAT_H = 16;

const CAMERA_LINE = LOGICAL_H * 0.42; // player is pushed down toward this line

// shooting
const BULLET_W = 7, BULLET_H = 16;
const BULLET_SPEED = 780;      // px/s, travels straight up
const SHOT_COOLDOWN = 0.28;    // seconds between shots while firing is held

const STORAGE_KEYS = {
  highScore:  'doodlesky_highscore',
  playerSkin: 'doodlesky_playerSkin',
  enemySkin:  'doodlesky_enemySkin'
};

/* ---------------------------- dom refs ---------------------------------- */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const app = document.getElementById('app');

const hud = document.getElementById('hud');
const scoreVal = document.getElementById('scoreVal');
const continueBtn = document.getElementById('continueBtn');

const screens = {
  menu: document.getElementById('menuScreen'),
  customize: document.getElementById('customizeScreen'),
  pause: document.getElementById('pauseScreen'),
  gameover: document.getElementById('gameOverScreen')
};

/* ------------------------------ utils ------------------------------------ */
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function lerpColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t))
  ];
}

/* ------------------------------ sound (tiny synth beeps) ------------------ */
let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { /* no audio support, ignore */ }
}
function playSound(kind) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  let freq = 440, dur = 0.08, type = 'square', vol = 0.06;
  if (kind === 'shoot')      { freq = 880; dur = 0.055; type = 'square'; vol = 0.045; }
  else if (kind === 'pop')   { freq = 540; dur = 0.14;  type = 'sawtooth'; vol = 0.06; }
  else if (kind === 'jump')  { freq = 300; dur = 0.07;  type = 'sine'; vol = 0.04; }
  else if (kind === 'hit')   { freq = 200; dur = 0.18;  type = 'triangle'; vol = 0.07; }
  else if (kind === 'gameover') { freq = 160; dur = 0.4; type = 'triangle'; vol = 0.07; }
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t);
  o.stop(t + dur);
}

/* ------------------------------ skins ------------------------------------ */
const skins = {
  player: { img: null, ready: false },
  enemy:  { img: null, ready: false }
};

function loadSkinFromStorage(kind, key) {
  const data = localStorage.getItem(key);
  if (!data) return;
  const img = new Image();
  img.onload = () => { skins[kind].img = img; skins[kind].ready = true; };
  img.src = data;
}
loadSkinFromStorage('player', STORAGE_KEYS.playerSkin);
loadSkinFromStorage('enemy', STORAGE_KEYS.enemySkin);

function setSkin(kind, dataUrl) {
  const key = kind === 'player' ? STORAGE_KEYS.playerSkin : STORAGE_KEYS.enemySkin;
  localStorage.setItem(key, dataUrl);
  const img = new Image();
  img.onload = () => { skins[kind].img = img; skins[kind].ready = true; refreshSkinPreview(kind); };
  img.src = dataUrl;
}
function resetSkin(kind) {
  const key = kind === 'player' ? STORAGE_KEYS.playerSkin : STORAGE_KEYS.enemySkin;
  localStorage.removeItem(key);
  skins[kind].img = null;
  skins[kind].ready = false;
  refreshSkinPreview(kind);
}
function refreshSkinPreview(kind) {
  const wrap = document.getElementById(kind === 'player' ? 'playerPreviewWrap' : 'enemyPreviewWrap');
  wrap.innerHTML = '';
  if (skins[kind].ready) {
    const img = document.createElement('img');
    img.src = skins[kind].img.src;
    wrap.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'preview-placeholder';
    span.textContent = kind === 'player' ? '🟢' : '🟣';
    wrap.appendChild(span);
  }
}

/* ------------------------------ high score -------------------------------- */
function getHighScore() { return parseInt(localStorage.getItem(STORAGE_KEYS.highScore) || '0', 10); }
function setHighScore(v) { localStorage.setItem(STORAGE_KEYS.highScore, String(v)); }

/* ------------------------------ VK Bridge (VK Mini Apps) -------------------
   Loaded conditionally: index.html includes
     <script src="https://unpkg.com/@vkontakte/vk-bridge/dist/browser.min.js"></script>
   When the game runs outside VK (e.g. opened locally, or hosted elsewhere),
   `vkBridge` is simply undefined and every call below is a no-op — the game
   plays exactly the same, just without ads/cloud save. `vkAvailable` only
   flips to true once VKWebAppInit actually succeeds (i.e. we're really
   running inside a VK client), mirroring how `ysdk` used to work.
   The platform language is read at startup via VKWebAppGetLaunchParams.
   ---------------------------------------------------------------------- */
let vkAvailable = false;

/* ------------------------------ platform I18N -------------------------------
   The platform language is read from VK's launch params during startup,
   even though the game currently has only one localized version. We keep
   Russian as the fallback.
   The game's own name is bilingual regardless of the rest of the UI: it
   shows "Дудл Скай" by default and switches to "Doodle Sky" the moment VK
   reports an English (or otherwise non-Russian) environment.
   -------------------------------------------------------------------------- */
const SUPPORTED_GAME_LANGUAGES = ['ru'];
let gameLanguage = 'ru';

const TITLE_I18N = {
  ru: { doc: 'Дудл Скай', first: 'Дудл', second: 'Скай' },
  en: { doc: 'Doodle Sky', first: 'Doodle', second: 'Sky' }
};

function applyTitleLanguage(normalizedLang) {
  // Russian keeps the Cyrillic name; every other platform language falls
  // back to the English name (that's the only other localized variant).
  const t = normalizedLang === 'ru' ? TITLE_I18N.ru : TITLE_I18N.en;
  document.title = t.doc;
  const titleEl = document.getElementById('gameTitle');
  if (titleEl) titleEl.innerHTML = `${t.first} <span>${t.second}</span>`;
}

function applyPlatformLanguage(lang) {
  const normalized = String(lang || '').toLowerCase().split('-')[0];
  gameLanguage = SUPPORTED_GAME_LANGUAGES.includes(normalized) ? normalized : 'ru';

  // Use the SDK-provided language immediately at startup. For the current
  // Russian-only build this selects the fallback, while keeping the game
  // ready for additional translation files later.
  document.documentElement.lang = gameLanguage;
  document.documentElement.dataset.platformLanguage = normalized || 'ru';

  applyTitleLanguage(normalized);
}

// VK moderation requires that sound stops when the mini app is backgrounded
// inside the VK client (VKWebAppViewHide) — a regular page `visibilitychange`
// is not reliable here since the app lives in a VK-managed iframe. We also
// auto-pause an in-progress run so the player doesn't come back to a
// surprise death.
function initVKLifecycleEvents() {
  vkBridge.subscribe((e) => {
    if (!e || !e.detail) return;
    if (e.detail.type === 'VKWebAppViewHide') {
      if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
      if (state === 'playing') togglePause();
    }
  });
}

function initVKBridge() {
  if (typeof vkBridge === 'undefined') return;

  initVKLifecycleEvents();

  vkBridge.send('VKWebAppInit').then(() => {
    vkAvailable = true;

    // read the platform language from VK's launch params on startup.
    vkBridge.send('VKWebAppGetLaunchParams').then((params) => {
      applyPlatformLanguage(params && params.vk_language ? params.vk_language : 'ru');
    }).catch(() => applyPlatformLanguage('ru'));

    syncHighScoreFromCloud();
  }).catch((e) => console.warn('VKWebAppInit failed:', e));
}

function syncHighScoreFromCloud() {
  if (!vkAvailable) return;
  vkBridge.send('VKWebAppStorageGet', { keys: ['highscore'] }).then((data) => {
    const entry = data && data.keys && data.keys.find((k) => k.key === 'highscore');
    const cloudScore = parseInt(entry && entry.value, 10) || 0;
    const localScore = getHighScore();
    if (cloudScore > localScore) {
      setHighScore(cloudScore);
      const el = document.getElementById('menuHighScore');
      if (el) el.textContent = cloudScore;
    } else if (localScore > cloudScore) {
      pushHighScoreToCloud(localScore);
    }
  }).catch(() => {});
}
function pushHighScoreToCloud(v) {
  if (!vkAvailable) return;
  vkBridge.send('VKWebAppStorageSet', { key: 'highscore', value: String(v) }).catch(() => {});
}

// VK Mini Apps have no direct equivalent of Yandex's GameplayAPI (a signal
// telling the platform when the player is in active gameplay) — kept as
// no-op stubs so the call sites below don't need to change.
function gameplayStart() {}
function gameplayStop() {}

// occasional fullscreen interstitial between runs (not on every single death)
let goCountSinceAd = 0;
function maybeShowInterstitial() {
  if (!vkAvailable) return;
  goCountSinceAd++;
  if (goCountSinceAd < 3) return;
  goCountSinceAd = 0;
  vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'interstitial' }).then((res) => {
    if (res && res.result) return vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' });
  }).catch(() => {});
}

// rewarded video → continue the run once after dying
let reviveUsed = false;
function offerRevive() {
  if (!continueBtn) return;
  continueBtn.classList.toggle('hidden', !(vkAvailable && !reviveUsed));
}
function watchAdAndRevive() {
  if (!vkAvailable || reviveUsed) return;
  vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'reward' }).then((res) => {
    if (!res || !res.result) return;
    return vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' });
  }).then((res) => {
    if (res && res.result) { reviveUsed = true; revivePlayer(); }
  }).catch(() => {});
}
// rewarded video from the pause menu → grant a shield bonus
const pauseShieldAdBtn = document.getElementById('pauseShieldAdBtn');
function offerPauseShieldAd() {
  if (!pauseShieldAdBtn) return;
  pauseShieldAdBtn.classList.toggle('hidden', !(vkAvailable && player && !player.shielded));
}
function watchAdForShield() {
  if (!vkAvailable || !player || player.shielded) return;
  vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'reward' }).then((res) => {
    if (!res || !res.result) return;
    return vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' });
  }).then((res) => {
    if (res && res.result) {
      applyItem('shield');
      popups.push({ x: player.x + player.w / 2, y: player.y - 10, text: 'ЩИТ!', life: 0.8 });
      playSound('hit');
      offerPauseShieldAd();
    }
  }).catch(() => {});
}

function revivePlayer() {
  state = 'playing';
  showScreen(null);
  hud.classList.remove('hidden');
  enemies = enemies.filter((en) => Math.abs(en.y - CAMERA_LINE) > 90);
  player.x = LOGICAL_W / 2 - player.w / 2;
  player.y = CAMERA_LINE - player.h;
  player.vx = 0;
  player.vy = JUMP_VY;
  player.invuln = 2.5;
  platforms.push({ x: player.x - 12, y: player.y + player.h + 4, w: PLAT_W + 24, h: PLAT_H, type: 'normal', vx: 0, dying: false, dieTimer: 0 });
  gameplayStart();
}

/* ------------------------------ input --------------------------------------
   Keyboard (arrows / A-D / space) AND full-screen tap zones both feed the
   same combined input state — no on-screen buttons needed:
     left third of the screen  -> move left
     right third of the screen -> move right
     middle third               -> shoot (hold to keep firing)
   Multi-touch aware, so e.g. holding a move zone with one finger and
   tapping the middle with another both work at once.
   -------------------------------------------------------------------------- */
/* ------------------------------ input --------------------------------------
   Keyboard (arrows / A-D / space) AND full-screen tap zones both feed the
   same combined input state — no on-screen buttons needed:
     left third of the screen  -> move left
     right third of the screen -> move right
     middle third               -> shoot (hold to keep firing)
   Multi-touch aware, so e.g. holding a move zone with one finger and
   tapping the middle with another both work at once.

   Keyboard layout: `e.code` reports the PHYSICAL key regardless of the
   active input language, so KeyA/KeyD/KeyW/KeyP already work with any
   layout, Russian ЙЦУКЕН included. We also check `e.key` against the
   Cyrillic letters that sit on those same physical keys (Ф/В/Ц/З), so
   layout switching or a browser that only reports `key` still works.
   -------------------------------------------------------------------------- */
const kb = { left: false, right: false, shoot: false };
const ptr = { left: false, right: false, shoot: false };
const input = { left: false, right: false }; // combined, read by update()
let isShootHeld = false; // combined, read by update()

function isLeftKey(e) {
  return e.code === 'ArrowLeft' || e.code === 'KeyA' ||
    e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф';
}
function isRightKey(e) {
  return e.code === 'ArrowRight' || e.code === 'KeyD' ||
    e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В';
}
function isShootKey(e) {
  return e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' ||
    e.key === ' ' || e.key === 'w' || e.key === 'W' || e.key === 'ц' || e.key === 'Ц';
}
function isPauseKey(e) {
  return e.code === 'Escape' || e.code === 'KeyP' ||
    e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З';
}

window.addEventListener('keydown', (e) => {
  if (isLeftKey(e)) kb.left = true;
  if (isRightKey(e)) kb.right = true;
  if (isShootKey(e)) kb.shoot = true;
  if (isPauseKey(e)) togglePause();
  syncInput();
});
window.addEventListener('keyup', (e) => {
  if (isLeftKey(e)) kb.left = false;
  if (isRightKey(e)) kb.right = false;
  if (isShootKey(e)) kb.shoot = false;
  syncInput();
});

function syncInput() {
  input.left = kb.left || ptr.left;
  input.right = kb.right || ptr.right;
  isShootHeld = kb.shoot || ptr.shoot;
}

const activePointers = new Map(); // pointerId -> zone ('left' | 'right' | 'mid')
function zoneForClientX(clientX) {
  const rect = app.getBoundingClientRect();
  const rel = (clientX - rect.left) / rect.width;
  if (rel < 1 / 3) return 'left';
  if (rel > 2 / 3) return 'right';
  return 'mid';
}
function recomputePointerZones() {
  let left = false, right = false, mid = false;
  for (const zone of activePointers.values()) {
    if (zone === 'left') left = true;
    else if (zone === 'right') right = true;
    else mid = true;
  }
  ptr.left = left; ptr.right = right; ptr.shoot = mid;
  syncInput();
}
app.addEventListener('pointerdown', (e) => {
  if (state !== 'playing') return;
  if (e.target.closest('button')) return;
  e.preventDefault();
  ensureAudio();
  try { app.setPointerCapture(e.pointerId); } catch (err) {}
  activePointers.set(e.pointerId, zoneForClientX(e.clientX));
  recomputePointerZones();
});
app.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, zoneForClientX(e.clientX));
  recomputePointerZones();
});
function releasePointer(e) {
  if (activePointers.has(e.pointerId)) {
    activePointers.delete(e.pointerId);
    recomputePointerZones();
  }
}
app.addEventListener('pointerup', releasePointer);
app.addEventListener('pointercancel', releasePointer);
app.addEventListener('pointerleave', releasePointer);
app.addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------ game state -------------------------------- */
let state = 'menu'; // menu | customize | playing | paused | gameover
let player, platforms, items, enemies, stars, popups, bullets;
let scrollY, score, bonus, difficultyScore;
let highestGenY;
let lastTime = 0;
let shotCooldown = 0;

function makePlayer() {
  return {
    x: LOGICAL_W / 2 - PLAYER_W / 2,
    y: LOGICAL_H - 120,
    w: PLAYER_W, h: PLAYER_H,
    vx: 0, vy: JUMP_VY,
    facing: 1,
    shielded: false,
    jetTimer: 0,
    propTimer: 0,
    invuln: 0,
    squash: 0
  };
}

function resetGame() {
  player = makePlayer();
  platforms = [];
  items = [];
  enemies = [];
  stars = [];
  popups = [];
  bullets = [];
  scrollY = 0;
  score = 0;
  bonus = 0;
  difficultyScore = 0;
  shotCooldown = 0;
  reviveUsed = false;

  // starting platform right under the player
  platforms.push({ x: LOGICAL_W / 2 - PLAT_W / 2, y: LOGICAL_H - 70, w: PLAT_W, h: PLAT_H, type: 'normal', vx: 0, dying: false, dieTimer: 0 });
  highestGenY = LOGICAL_H - 70;

  // fill the initial screen with easy platforms
  let y = highestGenY;
  while (y > -40) {
    y -= rand(78, 108);
    spawnPlatformAt(y, true);
  }
  highestGenY = y;
}

/* -------------------------- procedural generation -------------------------- */
function difficultyGap() {
  const t = clamp(difficultyScore / 4000, 0, 1);
  return { min: lerp(70, 96, t), max: lerp(104, 140, t) };
}
function chanceFor(kind) {
  const t = clamp(difficultyScore / 4000, 0, 1);
  switch (kind) {
    case 'moving':  return lerp(0.08, 0.30, t);
    case 'crumble': return lerp(0.05, 0.22, t);
    case 'flyer':   return difficultyScore > 600 ? lerp(0.03, 0.14, t) : 0;
    case 'spike':   return difficultyScore > 1100 ? lerp(0.02, 0.10, t) : 0;
    case 'item':    return 0.16;
    case 'star':    return 0.20;
    default: return 0;
  }
}

function spawnPlatformAt(y, easy) {
  const x = rand(8, LOGICAL_W - 8 - PLAT_W);
  let type = 'normal';
  if (!easy) {
    const r = Math.random();
    if (r < chanceFor('crumble')) type = 'crumble';
    else if (r < chanceFor('crumble') + chanceFor('moving')) type = 'moving';
  }
  const plat = {
    x, y, w: PLAT_W, h: PLAT_H, type,
    vx: type === 'moving' ? (Math.random() < 0.5 ? -1 : 1) * rand(60, 110) : 0,
    dying: false, dieTimer: 0
  };
  platforms.push(plat);

  if (easy) return plat;

  // attach either an item, an enemy, or nothing (mutually exclusive)
  const roll = Math.random();
  if (roll < chanceFor('item') && type !== 'crumble') {
    spawnItemOn(plat);
  } else if (roll < chanceFor('item') + chanceFor('spike') && type !== 'crumble' && type !== 'moving') {
    enemies.push({ type: 'spike', x: plat.x + plat.w / 2 - 16, y: plat.y - 30, w: 32, h: 30, vx: 0 });
  }

  if (Math.random() < chanceFor('flyer')) {
    const fy = y - rand(20, 60);
    enemies.push({ type: 'flyer', x: rand(20, LOGICAL_W - 60), y: fy, w: 38, h: 30, vx: (Math.random() < 0.5 ? -1 : 1) * rand(70, 130), wingPhase: Math.random() * 10 });
  }
  if (Math.random() < chanceFor('star')) {
    stars.push({ x: rand(24, LOGICAL_W - 24), y: y - rand(10, 50), r: 10, collected: false, phase: Math.random() * 10 });
  }
  return plat;
}

function spawnItemOn(plat) {
  const weights = [['spring', 0.45], ['jetpack', 0.2], ['propeller', 0.2], ['shield', 0.15]];
  let r = Math.random(), acc = 0, chosen = 'spring';
  for (const [k, w] of weights) { acc += w; if (r <= acc) { chosen = k; break; } }
  items.push({ type: chosen, plat, x: plat.x + plat.w / 2 - 12, y: plat.y - 26, w: 24, h: 24, consumed: false });
}

function generateAhead() {
  while (highestGenY > -60) {
    const gap = difficultyGap();
    highestGenY -= rand(gap.min, gap.max);
    spawnPlatformAt(highestGenY, false);
  }
}

/* -------------------------------- update ----------------------------------- */
function update(dt) {
  dt = Math.min(dt, 1 / 30); // clamp huge steps (tab switch etc.)

  // --- horizontal movement ---
  const propActive = player.propTimer > 0;
  const accel = MOVE_ACCEL;
  if (input.left && !input.right) {
    player.vx -= accel * dt;
    player.facing = -1;
  } else if (input.right && !input.left) {
    player.vx += accel * dt;
    player.facing = 1;
  } else {
    const decel = AIR_FRICTION * dt;
    if (player.vx > 0) player.vx = Math.max(0, player.vx - decel);
    else if (player.vx < 0) player.vx = Math.min(0, player.vx + decel);
  }
  const maxSpeed = propActive ? MAX_MOVE_SPEED * 1.25 : MAX_MOVE_SPEED;
  player.vx = clamp(player.vx, -maxSpeed, maxSpeed);
  player.x += player.vx * dt;

  // screen wrap
  if (player.x + player.w < 0) player.x = LOGICAL_W;
  if (player.x > LOGICAL_W) player.x = -player.w;

  // --- vertical movement ---
  if (player.jetTimer > 0) {
    player.jetTimer -= dt;
    player.vy = JETPACK_VY;
  } else {
    const g = propActive ? GRAVITY * PROPELLER_GRAVITY_MULT : GRAVITY;
    player.vy += g * dt;
  }
  if (propActive) player.propTimer -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  if (player.squash > 0) player.squash -= dt * 4;

  player.y += player.vy * dt;

  // --- platforms: move + landing collision (only while falling) ---
  for (const p of platforms) {
    if (p.type === 'moving') {
      p.x += p.vx * dt;
      if (p.x < 4) { p.x = 4; p.vx *= -1; }
      if (p.x + p.w > LOGICAL_W - 4) { p.x = LOGICAL_W - 4 - p.w; p.vx *= -1; }
    }
    if (p.dying) {
      p.dieTimer -= dt;
    }
  }
  if (player.vy > 0) {
    for (const p of platforms) {
      if (p.dying) continue;
      const footPrevY = player.y - player.vy * dt + player.h;
      const footY = player.y + player.h;
      const withinX = player.x + player.w * 0.2 < p.x + p.w && player.x + player.w * 0.8 > p.x;
      if (withinX && footPrevY <= p.y + 6 && footY >= p.y && player.y < p.y + p.h) {
        landOnPlatform(p);
        break;
      }
    }
  }

  // --- items ---
  for (const it of items) {
    if (it.consumed) continue;
    if (overlap(player.x, player.y, player.w, player.h, it.x, it.y, it.w, it.h)) {
      if (it.type !== 'spring') applyItem(it.type);
      if (it.type !== 'spring') it.consumed = true;
    }
  }

  // --- stars ---
  for (const s of stars) {
    if (s.collected) continue;
    if (overlap(player.x, player.y, player.w, player.h, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2)) {
      s.collected = true;
      bonus += 50;
      popups.push({ x: s.x, y: s.y, text: '+50', life: 0.9 });
    }
  }

  // --- shooting ---
  shotCooldown -= dt;
  if (isShootHeld && shotCooldown <= 0) {
    bullets.push({ x: player.x + player.w / 2 - BULLET_W / 2, y: player.y - 6, w: BULLET_W, h: BULLET_H, vy: -BULLET_SPEED });
    shotCooldown = SHOT_COOLDOWN;
    playSound('shoot');
  }
  for (const b of bullets) b.y += b.vy * dt;

  // --- enemies (move, get shot, or hit the player) ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    const en = enemies[i];
    if (en.type === 'flyer') {
      en.x += en.vx * dt;
      if (en.x < 0) { en.x = 0; en.vx *= -1; }
      if (en.x + en.w > LOGICAL_W) { en.x = LOGICAL_W - en.w; en.vx *= -1; }
      en.wingPhase += dt * 10;
    }

    let shot = false;
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (overlap(b.x, b.y, b.w, b.h, en.x, en.y, en.w, en.h)) {
        bullets.splice(j, 1);
        shot = true;
        break;
      }
    }
    if (shot) {
      bonus += 30;
      popups.push({ x: en.x + en.w / 2, y: en.y, text: '+30', life: 0.9 });
      playSound('pop');
      enemies.splice(i, 1);
      continue;
    }

    if (player.invuln <= 0 && overlap(player.x, player.y, player.w, player.h, en.x, en.y, en.w, en.h)) {
      handleEnemyHit(en);
    }
  }

  // --- popups ---
  for (const p of popups) { p.life -= dt; p.y -= dt * 30; }
  popups = popups.filter(p => p.life > 0);

  // --- camera scroll ---
  if (player.y < CAMERA_LINE && player.vy < 0) {
    const dy = CAMERA_LINE - player.y;
    player.y += dy;
    scrollY += dy;
    difficultyScore = scrollY / 3;
    for (const p of platforms) p.y += dy;
    for (const it of items) it.y += dy;
    for (const en of enemies) en.y += dy;
    for (const s of stars) s.y += dy;
    for (const p of popups) p.y += dy;
    for (const b of bullets) b.y += dy;
    highestGenY += dy;
  }

  // cleanup off-screen (below) + generate above
  platforms = platforms.filter(p => p.y < LOGICAL_H + 40 && !(p.dying && p.dieTimer < -0.05));
  items = items.filter(it => it.y < LOGICAL_H + 40 && !it.consumed);
  enemies = enemies.filter(en => en.y < LOGICAL_H + 60);
  stars = stars.filter(s => s.y < LOGICAL_H + 40 && !s.collected);
  bullets = bullets.filter(b => b.y + b.h > -20);
  generateAhead();

  score = Math.floor(scrollY / 10) + bonus;
  scoreVal.textContent = score;

  // --- fall off bottom => game over ---
  if (player.y > LOGICAL_H + 10) {
    endGame();
  }
}

function landOnPlatform(p) {
  const item = items.find(it => it.plat === p && !it.consumed && it.type === 'spring');
  player.vy = item ? SPRING_VY : JUMP_VY;
  player.y = p.y - player.h;
  player.squash = 1;
  playSound('jump');
  if (p.type === 'crumble' && !p.dying) {
    p.dying = true;
    p.dieTimer = 0.22;
  }
}

function applyItem(type) {
  if (type === 'jetpack') { player.jetTimer = JETPACK_TIME; player.invuln = JETPACK_TIME; }
  else if (type === 'propeller') { player.propTimer = PROPELLER_TIME; }
  else if (type === 'shield') { player.shielded = true; }
}

function handleEnemyHit(en) {
  if (player.shielded) {
    player.shielded = false;
    player.invuln = 0.6;
    player.vx = (player.x < en.x ? -1 : 1) * SHIELD_BUMP_VX;
    player.vy = -400;
    popups.push({ x: player.x + player.w / 2, y: player.y, text: 'ЩИТ!', life: 0.8 });
    playSound('hit');
  } else {
    endGame();
  }
}

/* -------------------------------- render ------------------------------------ */
const BG_STOPS = [
  [135, 206, 240], // day
  [255, 178, 132], // sunset
  [147, 112, 187], // dusk
  [35, 30, 70],    // night
];
function backgroundColorAt(t) {
  const n = BG_STOPS.length;
  const scaled = (t % n + n) % n;
  const i = Math.floor(scaled);
  const f = scaled - i;
  return lerpColor(BG_STOPS[i], BG_STOPS[(i + 1) % n], f);
}

function drawBackground() {
  const t = scrollY / 2200;
  const top = backgroundColorAt(t);
  const bottom = backgroundColorAt(t - 0.6);
  const g = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
  g.addColorStop(0, `rgb(${top.join(',')})`);
  g.addColorStop(1, `rgb(${bottom.join(',')})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // simple parallax clouds
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 6; i++) {
    const cx = (i * 137 + 50) % LOGICAL_W;
    const cy = ((i * 211 + scrollY * 0.25) % (LOGICAL_H + 120)) - 60;
    drawCloud(cx, cy, 26 + (i % 3) * 8);
  }
  ctx.globalAlpha = 1;

  // stars at night
  const nightAmt = clamp((((t % 4) + 4) % 4) - 3, 0, 1);
  if (nightAmt > 0) {
    ctx.globalAlpha = nightAmt * 0.8;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 20; i++) {
      const sx = (i * 53 + 17) % LOGICAL_W;
      const sy = ((i * 97 + scrollY * 0.15) % (LOGICAL_H + 100)) - 50;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}

function drawCloud(x, y, r) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.arc(x + r * 0.6, y + r * 0.1, r * 0.5, 0, Math.PI * 2);
  ctx.arc(x - r * 0.6, y + r * 0.15, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlatform(p) {
  ctx.save();
  let alpha = 1;
  if (p.dying) alpha = clamp(p.dieTimer / 0.22, 0, 1);
  ctx.globalAlpha = alpha;
  let fill = '#3FBE7A', edge = '#2E9760';
  if (p.type === 'moving') { fill = '#4EA8DE'; edge = '#3A86B8'; }
  if (p.type === 'crumble') { fill = '#B8734A'; edge = '#8f5a38'; }
  const shakeX = p.dying ? Math.sin(p.dieTimer * 60) * 2 : 0;
  ctx.translate(shakeX, 0);
  roundRect(p.x, p.y, p.w, p.h, 7);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#231942';
  ctx.stroke();
  ctx.fillStyle = edge;
  roundRect(p.x + 4, p.y + p.h - 5, p.w - 8, 4, 2);
  ctx.fill();
  if (p.type === 'crumble') {
    ctx.strokeStyle = '#6e4527';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x + 14, p.y + 3); ctx.lineTo(p.x + 20, p.y + p.h - 3);
    ctx.moveTo(p.x + p.w - 20, p.y + 2); ctx.lineTo(p.x + p.w - 14, p.y + p.h - 4);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawItem(it) {
  if (it.consumed) return;
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (it.type === 'spring') {
    ctx.strokeStyle = '#FFD166';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const yy = -8 + i * 5;
      ctx.moveTo(-9, yy); ctx.lineTo(9, yy + 2.5);
    }
    ctx.stroke();
  } else if (it.type === 'jetpack') {
    ctx.fillStyle = '#FF6B5C';
    roundRect(-8, -11, 16, 22, 4); ctx.fill();
    ctx.fillStyle = '#FFD166';
    ctx.beginPath(); ctx.arc(0, 9, 4, 0, Math.PI * 2); ctx.fill();
  } else if (it.type === 'propeller') {
    ctx.strokeStyle = '#231942'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -8); ctx.stroke();
    ctx.fillStyle = '#4EA8DE';
    ctx.beginPath(); ctx.ellipse(-8, -8, 9, 3.5, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, -8, 9, 3.5, -0.3, 0, Math.PI * 2); ctx.fill();
  } else if (it.type === 'shield') {
    ctx.fillStyle = '#4EA8DE';
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.quadraticCurveTo(10, -8, 9, 2);
    ctx.quadraticCurveTo(8, 9, 0, 12);
    ctx.quadraticCurveTo(-8, 9, -9, 2);
    ctx.quadraticCurveTo(-10, -8, 0, -11);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#231942'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}

function drawBullet(b) {
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
  ctx.fillStyle = '#FFD166';
  ctx.strokeStyle = '#231942';
  ctx.lineWidth = 1.5;
  roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 3);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,209,102,0.45)';
  ctx.beginPath(); ctx.ellipse(0, b.h / 2 + 3, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawStar(s) {
  if (s.collected) return;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = '#FFD166';
  ctx.strokeStyle = '#231942';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const a2 = a1 + Math.PI / 5;
    ctx.lineTo(Math.cos(a1) * s.r, Math.sin(a1) * s.r);
    ctx.lineTo(Math.cos(a2) * s.r * 0.45, Math.sin(a2) * s.r * 0.45);
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawDefaultPlayer(p) {
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  const stretch = clamp(p.vy / 900, -0.25, 0.35);
  const squash = p.squash > 0 ? p.squash * 0.25 : 0;
  ctx.scale(1 + squash - stretch * 0.15, 1 - squash + stretch * 0.25);
  ctx.scale(p.facing, 1);

  // body
  ctx.fillStyle = player.shielded ? '#8be3ff' : '#3FBE7A';
  ctx.strokeStyle = '#231942';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 2, p.w / 2 - 2, p.h / 2 - 2, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // feet
  ctx.fillStyle = '#2E9760';
  ctx.beginPath(); ctx.ellipse(-9, p.h / 2 - 5, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(9, p.h / 2 - 5, 7, 4, 0, 0, Math.PI * 2); ctx.fill();

  // eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(6, -6, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-6, -8, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#231942';
  ctx.beginPath(); ctx.arc(8, -6, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-4.5, -8, 2.4, 0, Math.PI * 2); ctx.fill();

  // antenna
  ctx.strokeStyle = '#231942'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -p.h / 2 + 4); ctx.lineTo(3, -p.h / 2 - 6); ctx.stroke();
  ctx.fillStyle = '#FF6B5C';
  ctx.beginPath(); ctx.arc(3, -p.h / 2 - 6, 3, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawPlayer() {
  if (skins.player.ready) {
    ctx.save();
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(player.facing, 1);
    const img = skins.player.img;
    const ratio = Math.min(player.w / img.width, player.h / img.height);
    const dw = img.width * ratio, dh = img.height * ratio;
    if (player.shielded) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#8be3ff';
      ctx.beginPath(); ctx.arc(0, 0, Math.max(dw, dh) / 2 + 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    drawDefaultPlayer(player);
  }
  if (player.jetTimer > 0) {
    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y + player.h);
    ctx.fillStyle = 'rgba(255,178,60,0.85)';
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, 16 + Math.random() * 8); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemy(en) {
  if (skins.enemy.ready) {
    ctx.save();
    const cx = en.x + en.w / 2, cy = en.y + en.h / 2;
    ctx.translate(cx, cy);
    if (en.type === 'flyer') ctx.scale(en.vx < 0 ? -1 : 1, 1);
    const img = skins.enemy.img;
    const ratio = Math.min(en.w / img.width, en.h / img.height);
    const dw = img.width * ratio, dh = img.height * ratio;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(en.x + en.w / 2, en.y + en.h / 2);
  if (en.type === 'spike') {
    ctx.fillStyle = '#8A5CF6';
    ctx.strokeStyle = '#231942'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    const spikes = 8;
    for (let i = 0; i < spikes; i++) {
      const a = (Math.PI * 2 * i) / spikes;
      const r1 = en.w / 2, r2 = en.w / 2 - 6;
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a + Math.PI / spikes) * r2, Math.sin(a + Math.PI / spikes) * r2);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4, -2, 3.5, 0, Math.PI * 2); ctx.arc(4, -2, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#231942';
    ctx.beginPath(); ctx.arc(-4, -2, 1.6, 0, Math.PI * 2); ctx.arc(4, -2, 1.6, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.scale(en.vx < 0 ? -1 : 1, 1);
    const wing = Math.sin(en.wingPhase) * 8;
    ctx.fillStyle = '#FF6B5C';
    ctx.strokeStyle = '#231942'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, en.w / 2, en.h / 2 - 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(-4, -wing, 10, 5, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-4, wing, 10, 5, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(6, -2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#231942';
    ctx.beginPath(); ctx.arc(8, -2, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPopups() {
  ctx.save();
  ctx.font = '800 14px "Baloo 2", sans-serif';
  ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.globalAlpha = clamp(p.life / 0.9, 0, 1);
    ctx.fillStyle = '#231942';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function render() {
  drawBackground();
  for (const p of platforms) drawPlatform(p);
  for (const it of items) drawItem(it);
  for (const s of stars) drawStar(s);
  for (const b of bullets) drawBullet(b);
  for (const en of enemies) drawEnemy(en);
  drawPlayer();
  drawPopups();
}

/* -------------------------------- main loop ---------------------------------- */
function frame(ts) {
  const dt = lastTime ? (ts - lastTime) / 1000 : 0;
  lastTime = ts;
  if (state === 'playing') update(dt);
  render();
  requestAnimationFrame(frame);
}

/* -------------------------------- screen mgmt --------------------------------- */
function showScreen(name) {
  for (const k in screens) screens[k].classList.add('hidden');
  if (name) screens[name].classList.remove('hidden');
}

function goToMenu() {
  state = 'menu';
  gameplayStop();
  hud.classList.add('hidden');
  document.getElementById('menuHighScore').textContent = getHighScore();
  showScreen('menu');
}

function startGame() {
  resetGame();
  state = 'playing';
  hud.classList.remove('hidden');
  showScreen(null);
  gameplayStart();
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    showScreen('pause');
    gameplayStop();
    offerPauseShieldAd();
  } else if (state === 'paused') {
    state = 'playing';
    showScreen(null);
    gameplayStart();
  }
}

function endGame() {
  state = 'gameover';
  gameplayStop();
  const hs = getHighScore();
  const isNew = score > hs;
  if (isNew) { setHighScore(score); pushHighScoreToCloud(score); }
  document.getElementById('finalScore').textContent = score;
  document.getElementById('finalHighScore').textContent = isNew ? score : hs;
  document.getElementById('newRecordBadge').classList.toggle('hidden', !isNew);
  hud.classList.add('hidden');
  showScreen('gameover');
  offerRevive();
  playSound('gameover');
  maybeShowInterstitial();
}

/* -------------------------------- ui wiring ------------------------------------ */
document.getElementById('playBtn').addEventListener('click', () => {
  ensureAudio();
  try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } catch (e) {}
  startGame();
});
document.getElementById('customizeBtn').addEventListener('click', () => { state = 'customize'; showScreen('customize'); });
document.getElementById('backFromCustomize').addEventListener('click', goToMenu);

document.getElementById('pauseBtn').addEventListener('click', togglePause);
document.getElementById('resumeBtn').addEventListener('click', togglePause);
if (pauseShieldAdBtn) pauseShieldAdBtn.addEventListener('click', watchAdForShield);
document.getElementById('restartFromPauseBtn').addEventListener('click', startGame);
document.getElementById('menuFromPauseBtn').addEventListener('click', goToMenu);

document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('menuBtn').addEventListener('click', goToMenu);
if (continueBtn) continueBtn.addEventListener('click', watchAdAndRevive);

function wireSkinInput(kind, inputId, resetId) {
  document.getElementById(inputId).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Пожалуйста, выбери изображение.'); return; }
    if (file.size > 3 * 1024 * 1024) { alert('Файл слишком большой (макс. 3 МБ).'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setSkin(kind, ev.target.result);
    reader.readAsDataURL(file);
  });
  document.getElementById(resetId).addEventListener('click', () => resetSkin(kind));
}
wireSkinInput('player', 'playerSkinInput', 'playerSkinReset');
wireSkinInput('enemy', 'enemySkinInput', 'enemySkinReset');

refreshSkinPreview('player');
refreshSkinPreview('enemy');

/* -------------------------------- stage scaling ----------------------------------
   #app is a fixed 400x650 "virtual resolution" box (see style.css). fitStage()
   measures the real available viewport and scales the whole box to fit inside
   it via CSS transform (letterbox scaling) — the composition itself never
   reflows or reformats, it's just shown bigger or smaller as one unit. This is
   what keeps the game looking identical and fully visible (no cropping, no
   scrollbars) at 100% / 125% / 150% browser zoom and on any screen size. */
const STAGE_MARGIN = 12;     // breathing room around the stage, in real CSS px
const STAGE_MAX_SCALE = 1.05; // don't blow the game up huge on big desktop screens

function fitStage() {
  const vv = window.visualViewport;
  const availW = (vv ? vv.width  : window.innerWidth)  - STAGE_MARGIN * 2;
  const availH = (vv ? vv.height : window.innerHeight) - STAGE_MARGIN * 2;
  const scale = Math.min(availW / LOGICAL_W, availH / LOGICAL_H, STAGE_MAX_SCALE);
  app.style.setProperty('--stage-scale', Math.max(scale, 0.1));
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = app.getBoundingClientRect(); // already reflects the CSS transform scale
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const scale = (rect.width / LOGICAL_W) * dpr;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function scheduleFit() {
  fitStage();
  resizeCanvas();
}
window.addEventListener('resize', scheduleFit);
window.addEventListener('orientationchange', scheduleFit);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleFit);
  window.visualViewport.addEventListener('scroll', scheduleFit);
}
scheduleFit();

/* -------------------------------- boot ------------------------------------------ */
goToMenu();
resetGame(); // build a world so the canvas has something drawn behind the menu
render();
requestAnimationFrame(frame);
initVKBridge();
