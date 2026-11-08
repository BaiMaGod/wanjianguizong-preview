import { Battle } from './battle.mjs';
import { directions, field, levelOne } from './level-one.mjs';

const byId = id => document.getElementById(id);
const stage = byId('stage');
const overlay = byId('overlay');
const primary = byId('primary');
const restart = byId('restart');
const home = byId('home');
const pause = byId('pause');
const talisman = byId('talisman');
const swordLayer = byId('swords');
const road = byId('road');
const ctx = byId('motion').getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const artwork = Object.fromEntries(['hero', 'enemy', 'sword'].map(name => {
  const image = new Image();
  image.src = new URL('../assets/' + name + '.webp', import.meta.url);
  return [name, image];
}));

let battle = new Battle(levelOne);
let shownStatus;
let shownGuide = '';
let shownBlock;
const swordButtons = new Map();
const setText = (node, text) => {
  const value = String(text);
  if (node.textContent !== value) node.textContent = value;
};

function resize() {
  const { clientWidth: w, clientHeight: h } = byId('viewport');
  stage.style.setProperty('--scale', Math.min(w / field.width, h / field.height));
}

new ResizeObserver(resize).observe(byId('viewport'));
resize();

for (let t = 114; t < battle.route.length - 110; t += 212) {
  const p = battle.route.at(t);
  const q = battle.route.at(t + 2);
  const angle = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  chevron.setAttribute('points', '-10,-11 1,0 -10,11 3,0');
  const twin = chevron.cloneNode();
  chevron.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ') rotate(' + angle + ')');
  twin.setAttribute('transform', chevron.getAttribute('transform') + ' translate(13 0)');
  road.append(chevron, twin);
}

function reset(start) {
  battle = new Battle(levelOne);
  shownStatus = undefined;
  shownBlock = undefined;
  for (const button of swordButtons.values()) button.remove();
  swordButtons.clear();
  if (start) battle.begin();
  render();
}

function choose(id) {
  battle.chooseSword(id);
  render();
}

pause.addEventListener('click', () => {
  battle.pause();
  render();
});
primary.addEventListener('click', () => {
  battle.begin();
  render();
});
restart.addEventListener('click', () => reset(true));
home.addEventListener('click', () => reset(false));
talisman.addEventListener('click', () => {
  battle.toggleTalisman();
  render();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (battle.targeting && battle.status === 'running') battle.toggleTalisman();
    else if (battle.status === 'running') battle.pause();
    else if (battle.status === 'paused') battle.begin();
    render();
  }
  if (event.key === 'Tab' && !overlay.hidden) {
    const buttons = [primary, restart, home].filter(button => !button.hidden);
    const end = event.shiftKey ? buttons[0] : buttons.at(-1);
    if (document.activeElement === end) {
      event.preventDefault();
      (event.shiftKey ? buttons.at(-1) : buttons[0]).focus();
    }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && battle.status === 'running') {
    battle.pause();
    render();
  }
});

function sprite(image, x, y, width, height, angle = 0, opacity = 1) {
  if (!image.complete || !image.naturalWidth) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = opacity;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function shadow(x, y, width, opacity = 0.4) {
  ctx.beginPath();
  ctx.ellipse(x, y, width, width * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(24, 26, 53, ' + opacity + ')';
  ctx.fill();
}

function ring(x, y, radius, color, opacity, width = 3) {
  ctx.globalAlpha = Math.max(0, opacity);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function paintEffect(effect) {
  const { type, x, y } = effect;
  const t = (battle.time - effect.at) / 0.9;
  if (type === 'miss' || type === 'leak' || type === 'kill' || type === 'hit') {
    ctx.save();
    ctx.globalAlpha = 1 - t * t;
    ctx.textAlign = type === 'leak' ? 'left' : 'center';
    ctx.font = 'bold 27px "Noto Serif CJK SC", serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#202238';
    ctx.fillStyle = type === 'leak' ? '#ffac9a' : '#fff0bc';
    const label = { miss: '落空', leak: '防线 −' + levelOne.enemy.leakDamage, kill: '破魔', hit: '命中' }[type];
    ctx.strokeText(label, x, y - 26 - t * 34);
    ctx.fillText(label, x, y - 26 - t * 34);
    ctx.restore();
  }
  if (type === 'kill' || type === 'hit' || type === 'break' || type === 'launch') {
    const color = type === 'break' ? '#ffcf7e' : '#bff5ff';
    ring(x, y, 14 + t * 90, color, (1 - t) * .82);
    if (!reducedMotion.matches) {
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 + .3;
        const radius = 21 + t * 106;
        ring(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 3, color, 1 - t);
      }
    }
  }
  if (type === 'blocked') {
    ring(x, y + 13, 37 + t * 12, '#ffac96', 1 - t, 4);
    const blocker = battle.swords.get(effect.blocker);
    if (blocker?.state === 'set') ring(blocker.x, blocker.y + 13, 40, '#ffdc94', 1 - t, 4);
  }
}

function paint() {
  ctx.clearRect(0, 0, field.width, field.height);
  if (battle.introCue) {
    const intro = battle.swords.get('intro');
    ctx.save();
    ctx.setLineDash([7, 10]);
    ctx.strokeStyle = '#c8f6ffbb';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(intro.x, intro.y - 43);
    ctx.lineTo(intro.x, levelOne.route[0][1]);
    ctx.stroke();
    ctx.restore();
    ring(intro.x, levelOne.route[0][1], 27, '#d2f6ff', .65);
  }

  for (const enemy of [...battle.enemies].sort((a, b) => a.y - b.y)) {
    const { x, y } = enemy;
    const facingRight = enemy.previous && enemy.x > enemy.previous.x + .15;
    const bob = reducedMotion.matches ? 0 : Math.sin(enemy.progress / 14) * 3;
    shadow(x, y + 21, 28);
    ctx.save();
    ctx.translate(x, 0);
    if (facingRight) ctx.scale(-1, 1);
    sprite(artwork.enemy, 0, y - 59 + bob, 98, 171);
    ctx.restore();
    ctx.fillStyle = '#1e1734';
    ctx.fillRect(x - 26, y - 153, 52, 9);
    ctx.fillStyle = '#f29780';
    ctx.fillRect(x - 24, y - 151, 48 * enemy.health / levelOne.enemy.health, 5);
  }

  const { x, y } = battle.hero;
  const active = battle.action?.sword;
  const height = active ? 221 : 304;
  shadow(x, y - 2, active ? 41 : 65, .24);
  sprite(artwork.hero, x + 5, y - height / 2, height * .677, height, active ? .1 : 0);
  if (active && battle.action.elapsed >= battle.action.move) {
    ring(active.x, active.y, 42, '#d6f9ff', .65);
  }

  for (const shot of battle.projectiles) {
    const d = directions[shot.direction];
    const tail = { x: shot.x - d.x * 160, y: shot.y - d.y * 160 };
    const trail = ctx.createLinearGradient(tail.x, tail.y, shot.x, shot.y);
    trail.addColorStop(0, '#63ceff00');
    trail.addColorStop(1, '#c8f6ff');
    ctx.strokeStyle = trail;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(shot.x, shot.y);
    ctx.stroke();
    sprite(artwork.sword, shot.x, shot.y, 37, 102, d.angle * Math.PI / 180);
  }
  for (const effect of battle.effects) paintEffect(effect);
}

function renderSwords() {
  const blocked = battle.effects.findLast(effect => effect.type === 'blocked');
  const cue = battle.introCue;
  for (const [id, button] of swordButtons) {
    if (battle.swords.has(id)) continue;
    button.remove();
    swordButtons.delete(id);
  }
  for (const sword of battle.swords.values()) {
    let button = swordButtons.get(sword.id);
    if (!button) {
      const d = directions[sword.direction];
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.sword = sword.id;
      button.setAttribute('aria-label', '第 ' + (sword.row + 1) + ' 行，第 ' + (sword.col + 1) + ' 列，朝' + d.label + '飞剑');
      button.style.left = sword.x + 'px';
      button.style.top = sword.y + 'px';
      button.style.setProperty('--angle', d.angle + 'deg');
      button.style.setProperty('--motion-x', d.x * 12 + 'px');
      button.style.setProperty('--motion-y', d.y * 12 + 'px');
      const image = document.createElement('img');
      image.src = artwork.sword.src;
      image.alt = '';
      button.append(image);
      button.addEventListener('click', () => choose(sword.id));
      swordLayer.append(button);
      swordButtons.set(sword.id, button);
    }
    const target = battle.targeting && battle.isTalismanTarget(sword);
    button.className = [
      'sword', sword.state === 'queued' && 'waiting', sword.id === 'front' && 'warm',
      target && 'target', battle.targeting && !target && 'dimmed',
      sword.id === 'intro' && cue && 'cue', sword.id === blocked?.id && 'blocked',
    ].filter(Boolean).join(' ');
    button.disabled = sword.state === 'queued' || battle.status !== 'running';
    button.dataset.state = sword.state;
    button.dataset.target = String(target);
  }

  if (shownBlock !== blocked) {
    const entries = [['blocked-label', blocked?.id], ['blocker-label', blocked?.blocker]];
    for (const [label, id] of entries) {
      const node = byId(label);
      const sword = battle.swords.get(id);
      node.hidden = !sword || sword.state !== 'set';
      if (node.hidden) continue;
      node.style.left = sword.x + 'px';
      node.style.top = (sword.y - 92) + 'px';
    }
    shownBlock = blocked;
  } else if (blocked) {
    byId('blocked-label').hidden = battle.swords.get(blocked.id)?.state !== 'set';
    byId('blocker-label').hidden = battle.swords.get(blocked.blocker)?.state !== 'set';
  }
}

function renderGuide() {
  const recent = battle.effects.at(-1)?.type;
  let step = '识剑 1/4';
  let message = '观察敌人，剑座亮起时点击出剑';
  if (battle.targeting) {
    step = '破阵符';
    message = recent === 'invalid' ? '这把剑没有挡路，请选金圈标记的飞剑' : '选择挡路飞剑，或点击下方取消';
  } else if (!battle.formationShown && !battle.remaining) {
    message = '御剑中 · 看剑锋与敌人是否相遇';
  } else if (battle.introCue) {
    message = '现在点击亮起的飞剑';
  } else if (battle.formationShown) {
    if (!battle.remaining) {
      step = '剑阵已清';
      message = '守住防线，等剩余敌潮结束';
    } else if (battle.unlockedRear && battle.swords.get('rear')?.state !== 'set') {
      step = '识时 4/4';
      message = '看准敌人经过攻击线的时机再出剑';
    } else if (battle.unlockedRear || battle.sawBlock) {
      step = '解阵 3/4';
      message = battle.unlockedRear ? '后方飞剑已解锁，点击即可预约' : '先点前方金色飞剑，再点后方';
    } else {
      step = '识阻 2/4';
      message = '点击中排靠左的横剑，看看谁挡住了它';
    }
  }
  const key = step + message;
  if (shownGuide !== key) {
    setText(byId('step'), step);
    setText(byId('instruction'), message);
    shownGuide = key;
  }
  byId('guide').hidden = battle.status !== 'running';
}

function renderOverlay() {
  const { status, stats } = battle;
  if (shownStatus === status) return;
  shownStatus = status;
  overlay.hidden = status === 'running';
  byId('swords').inert = !overlay.hidden;
  byId('pause').inert = !overlay.hidden;
  byId('talisman').inert = !overlay.hidden;
  if (overlay.hidden) return;
  const copy = {
    ready: ['护山试炼 · 第一关', '初试剑阵', '看准剑尖方向，御剑守住山门。', '入阵'],
    paused: ['护山试炼 · 第一关', '战斗暂停', '继续当前战斗，或重新开始本关。', '继续战斗'],
    victory: ['护山试炼 · 第一关', '护山成功', '剑阵已清，山门安然。'],
    defeat: ['护山试炼 · 第一关', '护山失守', '防线生命耗尽。重新入阵可再次挑战。'],
  }[status];
  for (const [i, id] of ['dialog-kicker', 'dialog-title', 'dialog-message'].entries()) setText(byId(id), copy[i]);
  primary.hidden = !copy[3];
  if (copy[3]) setText(primary, copy[3]);
  restart.hidden = status === 'ready';
  home.hidden = status === 'ready';
  const result = byId('result');
  result.hidden = status === 'ready' || status === 'paused';
  if (!result.hidden) {
    const hitRate = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
    const fields = [
      ['击败魔修', stats.kills], ['发射飞剑', stats.shots], ['命中率', hitRate + '%'],
      ['最高连剑', stats.bestCombo], ['剩余防线', battle.health + '/' + levelOne.health], ['漏怪', stats.leaks],
    ];
    result.replaceChildren(...fields.map(([label, value]) => {
      const row = document.createElement('div');
      const name = document.createElement('dt');
      const amount = document.createElement('dd');
      name.textContent = label;
      amount.textContent = value;
      row.append(name, amount);
      return row;
    }));
  }
  (primary.hidden ? restart : primary).focus({ preventScroll: true });
}

function render() {
  setText(byId('level'), '第 ' + levelOne.number + ' 关');
  setText(byId('wave'), '波次 ' + battle.wave + '/' + levelOne.waves.length);
  setText(byId('health'), battle.health + '/' + levelOne.health);
  const meter = byId('health-meter');
  meter.setAttribute('aria-valuenow', battle.health);
  meter.setAttribute('aria-valuemax', levelOne.health);
  meter.firstElementChild.style.width = (battle.health / levelOne.health * 100) + '%';
  meter.firstElementChild.classList.toggle('low', battle.health <= 1);
  setText(byId('charges'), battle.talismans);
  setText(byId('talisman-text'), battle.targeting ? '取消选符' : '破阵符');
  talisman.setAttribute('aria-pressed', String(battle.targeting));
  talisman.setAttribute('aria-label', battle.targeting ? '取消破阵符' : '破阵符');
  talisman.disabled = battle.status !== 'running' || !battle.formationShown || !battle.talismans;
  const combo = byId('combo');
  combo.hidden = battle.combo < 2;
  setText(combo, '连剑 ×' + battle.combo);
  renderSwords();
  renderGuide();
  renderOverlay();
  paint();
}

const tick = 1 / 120;
let previous;
let accumulator = 0;
function frame(now) {
  if (battle.status === 'running' && previous !== undefined) {
    accumulator += Math.min(.12, (now - previous) / 1000);
    while (accumulator >= tick) {
      battle.update(tick);
      accumulator -= tick;
    }
  } else {
    accumulator = 0;
  }
  previous = now;
  if (battle.status === 'running' || shownStatus !== battle.status) render();
  requestAnimationFrame(frame);
}

render();
Promise.allSettled(Object.values(artwork).map(image => image.decode())).then(render);
requestAnimationFrame(frame);
