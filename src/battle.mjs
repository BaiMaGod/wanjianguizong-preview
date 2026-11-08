import { directions, field } from './level-one.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const smooth = t => t * t * (3 - 2 * t);

function routeFrom(points) {
  let length = 0;
  const segments = points.slice(1).map(([x, y], i) => {
    const a = { x: points[i][0], y: points[i][1] };
    const b = { x, y };
    const segment = { a, b, start: length, length: distance(a, b) };
    length += segment.length;
    return segment;
  });
  return {
    length,
    at(progress) {
      const segment = segments.find(s => progress <= s.start + s.length) ?? segments.at(-1);
      return lerp(segment.a, segment.b, Math.min(1, (progress - segment.start) / segment.length));
    },
  };
}

// Earliest contact of a moving circle with another moving circle in the same tick.
function contact(from, to, enemyFrom, enemyTo, radius) {
  const x = from.x - enemyFrom.x;
  const y = from.y - enemyFrom.y;
  const dx = to.x - from.x - (enemyTo.x - enemyFrom.x);
  const dy = to.y - from.y - (enemyTo.y - enemyFrom.y);
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  const b = x * dx + y * dy;
  const discriminant = b * b - a * c;
  if (a === 0 || b >= 0 || discriminant < 0) return Infinity;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t <= 1 ? t : Infinity;
}

export class Battle {
  constructor(level) {
    this.level = level;
    this.route = routeFrom(level.route);
    this.schedule = level.waves.flatMap((times, wave) => times.map(time => ({ time, wave: wave + 1 })));
    this.time = 0;
    this.status = 'ready';
    this.wave = 1;
    this.spawned = 0;
    this.health = level.health;
    this.talismans = level.talismans;
    this.targeting = false;
    this.swords = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.queue = [];
    this.effects = [];
    this.hero = { ...level.hero };
    this.action = null;
    this.formationShown = false;
    this.sawBlock = false;
    this.unlockedRear = false;
    this.stats = { shots: 0, hits: 0, kills: 0, leaks: 0, bestCombo: 0 };
    this.combo = 0;
    this.lastHit = -Infinity;
    this.addSword(level.intro);
  }

  addSword(spec) {
    this.swords.set(spec.id, {
      ...spec, x: this.level.columns[spec.col], y: this.level.rows[spec.row], state: 'set',
    });
  }

  get remaining() {
    return [...this.swords.values()].filter(sword => sword.state === 'set').length;
  }

  blocker(sword) {
    const d = directions[sword.direction];
    let nearest = null;
    let gap = Infinity;
    for (const other of this.swords.values()) {
      if (other.state !== 'set') continue;
      const dx = other.col - sword.col;
      const dy = other.row - sword.row;
      if (dx * d.y !== dy * d.x) continue;
      const ahead = dx * d.x + dy * d.y;
      if (ahead > 0 && ahead < gap) {
        gap = ahead;
        nearest = other;
      }
    }
    return nearest;
  }

  isTalismanTarget(sword) {
    return sword.state === 'set' && [...this.swords.values()].some(
      other => other.state === 'set' && this.blocker(other) === sword,
    );
  }

  toggleTalisman() {
    if (this.status !== 'running' || !this.formationShown || !this.talismans) return;
    this.targeting = !this.targeting;
  }

  castDuration(from, sword) {
    const target = this.castTarget(sword);
    const { moveMin, moveMax, charge } = this.level.cast;
    return moveMin + (moveMax - moveMin) * Math.min(1, distance(from, target) / 1050) + charge;
  }

  castTarget(sword) {
    const d = directions[sword.direction];
    return { x: sword.x - d.x * 48, y: sword.y - d.y * 48 };
  }

  // The tutorial lights up as the first enemy approaches the real attack line.
  get introCue() {
    const sword = this.swords.get(this.level.intro.id);
    const enemy = this.enemies[0];
    if (!sword || sword.state !== 'set' || !enemy) return false;
    const flight = (sword.y - this.level.route[0][1]) / this.level.sword.speed;
    const projectedX = enemy.x + this.enemySpeed * (this.castDuration(this.hero, sword) + flight);
    return enemy.y === this.level.route[0][1] && Math.abs(sword.x - projectedX) <= 38;
  }

  get enemySpeed() {
    return this.level.enemy.baseSpeed * this.level.enemy.speedScale;
  }

  chooseSword(id) {
    const sword = this.swords.get(id);
    if (this.status !== 'running' || sword?.state !== 'set') return 'ignored';
    if (this.targeting) {
      if (!this.isTalismanTarget(sword)) {
        this.feedback('invalid', sword);
        return 'invalid';
      }
      this.swords.delete(id);
      this.talismans--;
      this.targeting = false;
      this.feedback('break', sword);
      if (id === 'front') this.unlockedRear = true;
      return 'removed';
    }
    const blocker = this.blocker(sword);
    if (blocker) {
      this.feedback('blocked', sword, { id, blocker: blocker.id });
      if (id === 'rear') this.sawBlock = true;
      return 'blocked';
    }
    sword.state = 'queued';
    this.queue.push(sword);
    if (id === 'front') this.unlockedRear = true;
    return 'queued';
  }

  feedback(type, position, details = {}) {
    this.effects.push({ type, x: position.x, y: position.y, at: this.time, ...details });
  }

  begin() {
    if (this.status === 'ready' || this.status === 'paused') this.status = 'running';
  }

  pause() {
    if (this.status === 'running') this.status = 'paused';
  }

  update(dt) {
    if (this.status !== 'running') return;
    const previousTime = this.time;
    this.time += dt;
    this.effects = this.effects.filter(effect => this.time - effect.at < 0.9);
    if (this.time - this.lastHit > this.level.comboWindow) this.combo = 0;

    while (this.schedule[this.spawned]?.time <= this.time + 1e-8) {
      const spawn = this.schedule[this.spawned++];
      this.wave = spawn.wave;
      this.enemies.push({
        ...this.route.at(0), id: this.spawned, health: this.level.enemy.health,
        progress: 0, at: spawn.time,
      });
    }

    this.updateCast(dt);
    for (const enemy of this.enemies) {
      enemy.previous = { x: enemy.x, y: enemy.y };
      enemy.progress += this.enemySpeed * (this.time - Math.max(previousTime, enemy.at));
      Object.assign(enemy, this.route.at(enemy.progress));
    }
    this.projectiles = this.projectiles.filter(shot => this.updateShot(shot, dt));
    this.enemies = this.enemies.filter(enemy => {
      if (enemy.health <= 0) return false;
      if (enemy.progress < this.route.length) return true;
      this.health = Math.max(0, this.health - this.level.enemy.leakDamage);
      this.stats.leaks++;
      this.feedback('leak', enemy);
      return false;
    });

    if (this.health === 0) {
      this.status = 'defeat';
      this.action = null;
      this.queue.length = 0;
      this.projectiles.length = 0;
      this.targeting = false;
      for (const sword of this.swords.values()) {
        if (sword.state === 'queued') this.swords.delete(sword.id);
      }
    } else if (this.formationShown && this.spawned === this.schedule.length &&
      !this.enemies.length && !this.swords.size && !this.projectiles.length && !this.action) {
      this.status = 'victory';
      this.targeting = false;
    }
  }

  updateCast(dt) {
    if ((!this.action || !this.action.sword) && this.queue.length) {
      const sword = this.queue.shift();
      const duration = this.castDuration(this.hero, sword);
      this.action = {
        sword, elapsed: 0, from: this.hero, to: this.castTarget(sword),
        move: duration - this.level.cast.charge, duration,
      };
    }
    const action = this.action;
    if (!action) return;
    action.elapsed = Math.min(action.duration, action.elapsed + dt);
    this.hero = lerp(action.from, action.to, smooth(Math.min(1, action.elapsed / action.move)));
    if (action.elapsed < action.duration) return;
    if (!action.sword) {
      this.action = null;
      return;
    }
    const sword = action.sword;
    this.swords.delete(sword.id);
    this.projectiles.push({ x: sword.x, y: sword.y, id: sword.id, direction: sword.direction });
    this.stats.shots++;
    this.feedback('launch', sword);
    const duration = this.level.cast.return;
    this.action = this.queue.length ? null : {
      from: this.hero, to: this.level.hero, elapsed: 0, move: duration, duration,
    };
  }

  updateShot(shot, dt) {
    const d = directions[shot.direction];
    const speed = this.level.sword.speed;
    const next = { x: shot.x + d.x * speed * dt, y: shot.y + d.y * speed * dt };
    let target = null;
    let hitTime = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue;
      const t = contact(shot, next, enemy.previous, enemy, this.level.sword.radius + this.level.enemy.radius);
      if (t < hitTime) {
        hitTime = t;
        target = enemy;
      }
    }
    if (target) {
      target.health -= this.level.sword.damage;
      this.stats.hits++;
      this.combo++;
      this.lastHit = this.time;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
      if (target.health <= 0) this.stats.kills++;
      this.feedback(target.health <= 0 ? 'kill' : 'hit', lerp(shot, next, hitTime));
      this.finishIntro(shot);
      return false;
    }
    if (next.x < -55 || next.x > field.width + 55 || next.y < -55 || next.y > 1380) {
      const edge = { x: Math.max(54, Math.min(868, shot.x)), y: Math.max(277, Math.min(1261, shot.y)) };
      this.feedback('miss', edge);
      this.finishIntro(shot);
      return false;
    }
    Object.assign(shot, next);
    return true;
  }

  finishIntro(shot) {
    if (shot.id !== this.level.intro.id) return;
    this.formationShown = true;
    for (const sword of this.level.formation) this.addSword(sword);
  }
}
