const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const healthBar = document.getElementById('healthBar');
const ammoText = document.getElementById('ammoText');
const scoreText = document.getElementById('scoreText');
const statusText = document.getElementById('statusText');
const titleText = document.getElementById('titleText');
const subText = document.getElementById('subText');

const world = {
  width: 2400,
  height: 1800,
};

const state = {
  pointerX: 0,
  pointerY: 0,
  mouseDown: false,
  keys: Object.create(null),
  lastTime: 0,
  shake: 0,
  wave: 1,
  score: 0,
  elapsed: 0,
  spawnTimer: 0,
  gameOver: false,
  accessBlocked: false,
  message: 'MISSION LIVE',
};

const player = {
  x: world.width / 2,
  y: world.height / 2,
  radius: 18,
  speed: 260,
  health: 100,
  maxHealth: 100,
  angle: 0,
  cooldown: 0,
  reload: 0,
  ammo: 12,
  reserve: 48,
  clipSize: 12,
};

const bullets = [];
const enemies = [];
const particles = [];
const pickups = [];
const hitMarkers = [];

const obstacles = [
  { x: 480, y: 520, w: 210, h: 160 },
  { x: 980, y: 400, w: 180, h: 210 },
  { x: 1520, y: 820, w: 260, h: 170 },
  { x: 1180, y: 1120, w: 220, h: 180 },
  { x: 540, y: 1250, w: 200, h: 170 },
  { x: 1740, y: 350, w: 180, h: 220 },
  { x: 1980, y: 1280, w: 260, h: 190 },
];

let audioCtx = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ensureAudio() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
    }
  }

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(frequency, duration, type = 'square', volume = 0.05, sweep = 0) {
  if (!audioCtx) return;

  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  if (sweep) {
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * sweep,
      audioCtx.currentTime + duration
    );
  }

  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + duration);
}

function updateHUD() {
  const healthRatio = clamp(player.health / player.maxHealth, 0, 1);
  healthBar.style.width = `${healthRatio * 100}%`;
  ammoText.textContent = `${player.ammo} / ${player.reserve}`;
  scoreText.textContent = String(state.score);
  statusText.textContent = state.message;
}

function setMessage(text) {
  state.message = text;
  updateHUD();
}

function fireBullet() {
  if (state.gameOver || state.accessBlocked) return;

  if (player.ammo <= 0) {
    if (player.reserve > 0) {
      setMessage('RELOADING');
    }
    return;
  }

  if (player.cooldown > 0 || player.reload > 0) return;

  const spread = rand(-0.08, 0.08);
  const angle = player.angle + spread;
  const speed = 820;

  bullets.push({
    x: player.x + Math.cos(angle) * 28,
    y: player.y + Math.sin(angle) * 28,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 4,
    life: 1.1,
    damage: 24,
  });

  player.ammo -= 1;
  player.cooldown = 0.09;
  state.shake = Math.min(14, state.shake + 3.5);

  for (let i = 0; i < 10; i++) {
    particles.push({
      x: player.x + Math.cos(angle) * 24,
      y: player.y + Math.sin(angle) * 24,
      vx: Math.cos(angle) * rand(30, 130) + rand(-20, 20),
      vy: Math.sin(angle) * rand(30, 130) + rand(-20, 20),
      r: rand(1.2, 3.6),
      life: rand(0.12, 0.35),
      color: i % 2 === 0 ? '#ffc266' : '#fef5c4',
    });
  }

  playTone(110, 0.045, 'square', 0.04, 0.78);
  playTone(60, 0.07, 'sawtooth', 0.045, 1.25);

  if (player.ammo <= 0 && player.reserve > 0) {
    setMessage('MAG EMPTY');
  }
}

function reloadWeapon() {
  if (player.reload > 0 || player.ammo === player.clipSize || player.reserve <= 0) return;
  player.reload = 1.1;
  setMessage('RELOADING');
  playTone(220, 0.11, 'triangle', 0.025, 1.5);
}

function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;

  if (side === 0) {
    x = rand(-80, world.width + 80);
    y = -100;
  } else if (side === 1) {
    x = world.width + 100;
    y = rand(-80, world.height + 80);
  } else if (side === 2) {
    x = rand(-80, world.width + 80);
    y = world.height + 100;
  } else {
    x = -100;
    y = rand(-80, world.height + 80);
  }

  const health = 28 + state.wave * 8;
  enemies.push({
    x,
    y,
    radius: 20,
    speed: 54 + state.wave * 6,
    health,
    maxHealth: health,
    hitFlash: 0,
    attackCooldown: 0,
    hue: Math.random() * 30 + 6,
  });
}

function createPickup(x, y) {
  pickups.push({
    x,
    y,
    radius: 10,
    value: 12,
    pulse: Math.random() * Math.PI * 2,
  });
}

function update(dt) {
  state.elapsed += dt;

  if (state.gameOver || state.accessBlocked) {
    return;
  }

  const moveX = (state.keys['KeyD'] || state.keys['ArrowRight'] ? 1 : 0) - (state.keys['KeyA'] || state.keys['ArrowLeft'] ? 1 : 0);
  const moveY = (state.keys['KeyS'] || state.keys['ArrowDown'] ? 1 : 0) - (state.keys['KeyW'] || state.keys['ArrowUp'] ? 1 : 0);

  let dx = 0;
  let dy = 0;
  if (moveX || moveY) {
    const len = Math.hypot(moveX, moveY) || 1;
    dx = (moveX / len) * player.speed;
    dy = (moveY / len) * player.speed;
  }

  player.x = clamp(player.x + dx * dt, player.radius, world.width - player.radius);
  player.y = clamp(player.y + dy * dt, player.radius, world.height - player.radius);

  const mouseWorldX = camera.x + state.pointerX;
  const mouseWorldY = camera.y + state.pointerY;
  player.angle = Math.atan2(mouseWorldY - player.y, mouseWorldX - player.x);

  if (player.cooldown > 0) player.cooldown -= dt;
  if (player.reload > 0) {
    player.reload -= dt;
    if (player.reload <= 0) {
      const needed = player.clipSize - player.ammo;
      const toLoad = Math.min(needed, player.reserve);
      player.ammo += toLoad;
      player.reserve -= toLoad;
      setMessage('READY');
    }
  }

  if (state.mouseDown) {
    fireBullet();
  }

  const forcedWave = Math.min(12, 1 + Math.floor(state.elapsed / 16));
  if (forcedWave !== state.wave) {
    state.wave = forcedWave;
    setMessage(`WAVE ${state.wave}`);
  }

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    const spawnCount = Math.min(3 + state.wave, 6);
    for (let i = 0; i < spawnCount; i++) {
      spawnEnemy();
    }
    state.spawnTimer = Math.max(1.2, 3.6 - state.wave * 0.16);
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;

    if (
      bullet.life <= 0 ||
      bullet.x < -20 || bullet.x > world.width + 20 ||
      bullet.y < -20 || bullet.y > world.height + 20
    ) {
      bullets.splice(i, 1);
      continue;
    }

    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];
      const dist = Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y);
      if (dist < bullet.radius + enemy.radius) {
        enemy.health -= bullet.damage;
        enemy.hitFlash = 0.15;
        state.shake = Math.min(16, state.shake + 2.5);
        playTone(260, 0.05, 'square', 0.02, 1.5);

        for (let p = 0; p < 12; p++) {
          particles.push({
            x: enemy.x,
            y: enemy.y,
            vx: rand(-80, 80),
            vy: rand(-80, 80),
            r: rand(2, 5),
            life: rand(0.18, 0.55),
            color: '#ff725e',
          });
        }

        if (enemy.health <= 0) {
          state.score += 10;
          if (Math.random() < 0.18) createPickup(enemy.x, enemy.y);
          enemies.splice(j, 1);
        }

        bullets.splice(i, 1);
        hit = true;
        break;
      }
    }

    if (hit) continue;

    for (const obs of obstacles) {
      const closestX = clamp(bullet.x, obs.x, obs.x + obs.w);
      const closestY = clamp(bullet.y, obs.y, obs.y + obs.h);
      const dx = bullet.x - closestX;
      const dy = bullet.y - closestY;
      if (dx * dx + dy * dy < bullet.radius * bullet.radius) {
        bullets.splice(i, 1);
        hit = true;
        break;
      }
    }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    const moveX = (dx / dist) * enemy.speed * dt;
    const moveY = (dy / dist) * enemy.speed * dt;

    enemy.x += moveX;
    enemy.y += moveY;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.attackCooldown -= dt;

    let blocked = false;
    for (const obs of obstacles) {
      if (
        enemy.x + enemy.radius > obs.x &&
        enemy.x - enemy.radius < obs.x + obs.w &&
        enemy.y + enemy.radius > obs.y &&
        enemy.y - enemy.radius < obs.y + obs.h
      ) {
        blocked = true;
        break;
      }
    }

    if (blocked) {
      enemy.x -= moveX;
      enemy.y -= moveY;
    }

    if (dist < player.radius + enemy.radius + 6 && enemy.attackCooldown <= 0) {
      player.health = Math.max(0, player.health - 12);
      enemy.attackCooldown = 0.8;
      state.shake = Math.min(18, state.shake + 6);
      playTone(90, 0.08, 'sawtooth', 0.04, 1.3);
      hitMarkers.push({ x: canvas.width * 0.5, y: canvas.height * 0.5, life: 0.4, value: '-12' });

      if (player.health <= 0) {
        endGame();
      }
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }

  for (let i = pickups.length - 1; i >= 0; i--) {
    const pickup = pickups[i];
    const dist = Math.hypot(player.x - pickup.x, player.y - pickup.y);
    pickup.pulse += dt * 3;
    if (dist < pickup.radius + player.radius + 6) {
      player.reserve = Math.min(player.reserve + pickup.value, 120);
      pickups.splice(i, 1);
      setMessage('SUPPLY DROP');
      playTone(440, 0.12, 'triangle', 0.02, 1.9);
    }
  }

  state.shake = Math.max(0, state.shake - dt * 22);
  updateHUD();
}

function endGame() {
  state.gameOver = true;
  titleText.textContent = 'MISSION FAILED';
  subText.textContent = `Final score: ${state.score}. Click to restart.`;
  state.message = 'DOWN';
  updateHUD();
  window.dispatchEvent(new CustomEvent('game:finished', {
    detail: {
      score: state.score,
      wave: state.wave,
      durationSeconds: Math.floor(state.elapsed),
    },
  }));
}

function resetGame() {
  player.x = world.width / 2;
  player.y = world.height / 2;
  player.health = 100;
  player.ammo = 12;
  player.reserve = 48;
  player.reload = 0;
  player.cooldown = 0;
  state.score = 0;
  state.elapsed = 0;
  state.wave = 1;
  state.spawnTimer = 1.2;
  state.gameOver = false;
  state.shake = 0;
  bullets.length = 0;
  enemies.length = 0;
  particles.length = 0;
  pickups.length = 0;
  titleText.textContent = 'Urban Siege';
  subText.textContent = 'Hold the line against the night assault.';
  setMessage('MISSION LIVE');
}

const camera = {
  x: 0,
  y: 0,
};

function drawBackground() {
  const gradient = ctx.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.5,
    100,
    canvas.width * 0.5,
    canvas.height * 0.5,
    canvas.width * 0.8
  );
  gradient.addColorStop(0, '#172638');
  gradient.addColorStop(0.6, '#0d1722');
  gradient.addColorStop(1, '#03080d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x < world.width; x += 150) {
    for (let y = 0; y < world.height; y += 150) {
      const gx = x - camera.x;
      const gy = y - camera.y;
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
      ctx.fillRect(gx, gy, 120, 120);
    }
  }
}

function drawObstacles() {
  for (const obs of obstacles) {
    const x = obs.x - camera.x;
    const y = obs.y - camera.y;
    const gradient = ctx.createLinearGradient(x, y, x + obs.w, y + obs.h);
    gradient.addColorStop(0, '#1a2c36');
    gradient.addColorStop(1, '#101b20');

    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, obs.w, obs.h);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, obs.w, obs.h);
  }
}

function drawPickup(pickup) {
  const x = pickup.x - camera.x;
  const y = pickup.y - camera.y;
  const glow = 18 + Math.sin(pickup.pulse) * 4;

  ctx.beginPath();
  ctx.fillStyle = 'rgba(126, 235, 173, 0.18)';
  ctx.arc(x, y, glow + 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = '#7ae4a8';
  ctx.rect(x - 8, y - 2, 16, 4);
  ctx.fill();
  ctx.fillRect(x - 2, y - 8, 4, 16);
}

function drawBullets() {
  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.fillStyle = '#ffe09a';
    ctx.arc(bullet.x - camera.x, bullet.y - camera.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnemies() {
  for (const enemy of enemies) {
    const x = enemy.x - camera.x;
    const y = enemy.y - camera.y;
    const base = enemy.hitFlash > 0 ? '#ffd0ca' : `hsl(${enemy.hue}, 74%, 62%)`;

    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.ellipse(x + 4, y + 14, 20, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    const healthRatio = clamp(enemy.health / enemy.maxHealth, 0, 1);
    ctx.fillStyle = '#1b1d21';
    ctx.fillRect(x - 22, y - 28, 44, 6);
    ctx.fillStyle = '#ff5e5b';
    ctx.fillRect(x - 22, y - 28, 44 * healthRatio, 6);

    ctx.beginPath();
    ctx.fillStyle = base;
    ctx.arc(x, y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = '#220d10';
    ctx.arc(x - 6, y - 3, 5, 0, Math.PI * 2);
    ctx.arc(x + 6, y - 3, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = '#1a0f12';
    ctx.lineWidth = 2;
    ctx.arc(x, y + 5, 8, 0.1, Math.PI - 0.1);
    ctx.stroke();
  }
}

function drawPlayer() {
  const px = player.x - camera.x;
  const py = player.y - camera.y;

  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.ellipse(px + 4, py + 18, 24, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  const gunAngle = player.angle;
  const gunOffsetX = Math.cos(gunAngle) * 18;
  const gunOffsetY = Math.sin(gunAngle) * 18;

  ctx.beginPath();
  ctx.fillStyle = '#0e1d29';
  ctx.arc(px, py, player.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = '#7cc6ff';
  ctx.arc(px - 7, py - 2, 4, 0, Math.PI * 2);
  ctx.arc(px + 7, py - 2, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = '#e7f4ff';
  ctx.lineWidth = 3;
  ctx.moveTo(px, py);
  ctx.lineTo(px + Math.cos(gunAngle) * 20, py + Math.sin(gunAngle) * 20);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = '#e5c27a';
  ctx.fillRect(
    px + Math.cos(gunAngle) * 16 - 5,
    py + Math.sin(gunAngle) * 16 - 5,
    10,
    10
  );

  if (player.cooldown > 0) {
    const flareAlpha = clamp(player.cooldown / 0.09, 0, 1);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 203, 98, ${0.5 * flareAlpha})`;
    ctx.arc(px + Math.cos(gunAngle) * 26, py + Math.sin(gunAngle) * 26, 15 * flareAlpha, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.globalAlpha = clamp(p.life * 3, 0, 1);
    ctx.arc(p.x - camera.x, p.y - camera.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawCrosshair() {
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;

  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx - 3, cy);
  ctx.moveTo(cx + 3, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy - 3);
  ctx.moveTo(cx, cy + 3);
  ctx.lineTo(cx, cy + 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(110, 200, 255, 0.8)';
  ctx.stroke();
}

function drawVignette() {
  const vignette = ctx.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.5,
    Math.min(canvas.width, canvas.height) * 0.25,
    canvas.width * 0.5,
    canvas.height * 0.5,
    Math.max(canvas.width, canvas.height) * 0.8
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  camera.x = clamp(player.x - canvas.width * 0.5, 0, world.width - canvas.width);
  camera.y = clamp(player.y - canvas.height * 0.5, 0, world.height - canvas.height);

  ctx.save();
  if (state.shake > 0) {
    ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
  }

  drawBackground();
  drawObstacles();
  drawBullets();
  drawPickups();
  drawParticles();
  drawEnemies();
  drawPlayer();
  ctx.restore();

  drawCrosshair();
  drawVignette();
}

function drawPickups() {
  for (const pickup of pickups) {
    drawPickup(pickup);
  }
}

function gameLoop(timestamp) {
  const dt = Math.min(0.033, (timestamp - state.lastTime) / 1000 || 0.016);
  state.lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLElement && event.target.closest('input, button, dialog')) return;
  state.keys[event.code] = true;
  if (event.code === 'KeyR') reloadWeapon();
  if (event.code === 'Space' && !state.gameOver) fireBullet();
});

window.addEventListener('keyup', (event) => {
  state.keys[event.code] = false;
});

canvas.addEventListener('pointerdown', (event) => {
  ensureAudio();
  state.mouseDown = true;
  if (state.gameOver && !state.accessBlocked) {
    resetGame();
  }
  if (player.reload <= 0) {
    fireBullet();
  }
});

window.addEventListener('pointerup', () => {
  state.mouseDown = false;
});

canvas.addEventListener('pointermove', (event) => {
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
});

window.addEventListener('game:access', (event) => {
  state.accessBlocked = event.detail.blocked;
  if (state.accessBlocked) {
    state.gameOver = true;
    state.message = 'ACCOUNT SUSPENDED';
    titleText.textContent = 'Access suspended';
    subText.textContent = 'Contact the game owner for assistance.';
  }
  updateHUD();
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

resizeCanvas();
resetGame();
requestAnimationFrame(gameLoop);
