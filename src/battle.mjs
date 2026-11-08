import { directions, field } from './level-one.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const smooth = t => t * t * (3 - 2 * t);
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

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
    entryFrom(origin, direction) {
      let entry = null;
      for (const segment of segments) {
        const { a, b } = segment;
        const edgeX = b.x - a.x;
        const edgeY = b.y - a.y;
        const offsetX = a.x - origin.x;
        const offsetY = a.y - origin.y;
        const denominator = cross(direction.x, direction.y, edgeX, edgeY);
        if (denominator === 0) continue;
        const along = cross(offsetX, offsetY, edgeX, edgeY) / denominator;
        const fraction = cross(offsetX, offsetY, direction.x, direction.y) / denominator;
        if (along < 0 || fraction < 0 || fraction > 1 || (entry && along >= entry.distance)) continue;
        entry = { ...lerp(a, b, fraction), distance: along, progress: segment.start + fraction * segment.length };
      }
      return entry;
    },
    backToSpawn(progress) {
      return segments.filter(segment => segment.start < progress).reverse().map(segment => segment.a);
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
    const sword = {
      ...spec, x: this.level.columns[spec.col], y: this.level.rows[spec.row], state: 'set',
    };
    sword.roadEntry = this.route.entryFrom(sword, directions[sword.direction]);
    this.swords.set(spec.id, sword);
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

  // Light the tutorial sword while an enemy can still meet it on the reverse leg.
  get introCue() {
    const sword = this.swords.get(this.level.intro.id);
    if (!sword?.roadEntry || sword.state !== 'set') return false;
    const approach = this.castDuration(this.hero, sword) + sword.roadEntry.distance / this.level.sword.speed;
    return this.enemies.some(enemy => enemy.progress + this.enemySpeed * approach <= sword.roadEntry.progress);
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
      enemy.activeFrom = Math.min(dt, Math.max(0, enemy.at - previousTime));
      enemy.activeUntil = Math.min(dt, enemy.activeFrom + (this.route.length - enemy.progress) / this.enemySpeed);
      enemy.progress += this.enemySpeed * (dt - enemy.activeFrom);
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
    const direction = directions[sword.direction];
    const { x, y, id, roadEntry } = sword;
    const edge = {
      x: direction.x ? (direction.x < 0 ? -55 : field.width + 55) : x,
      y: direction.y ? (direction.y < 0 ? -55 : field.height + 55) : y,
    };
    this.projectiles.push({
      x, y, id, roadEntry, angle: direction.angle * Math.PI / 180, nextPoint: 0, distance: 0,
      waypoints: roadEntry ? [roadEntry, ...this.route.backToSpawn(roadEntry.progress)] : [edge],
      trail: [{ x, y, distance: 0 }],
    });
    this.stats.shots++;
    this.feedback('launch', sword);
    const duration = this.level.cast.return;
    this.action = this.queue.length ? null : {
      from: this.hero, to: this.level.hero, elapsed: 0, move: duration, duration,
    };
  }

  updateShot(shot, dt) {
    let elapsed = 0;
    while (elapsed < dt && shot.nextPoint < shot.waypoints.length) {
      const waypoint = shot.waypoints[shot.nextPoint];
      const length = distance(shot, waypoint);
      if (length <= 1e-8) {
        shot.nextPoint++;
        continue;
      }
      const { speed, routeSpeed = speed } = this.level.sword;
      const velocity = shot.nextPoint === 0 ? speed : routeSpeed;
      const legDuration = length / velocity;
      const duration = Math.min(legDuration, dt - elapsed);
      const next = duration === legDuration ? waypoint : lerp(shot, waypoint, duration / legDuration);
      if (this.hitDuring(shot, next, elapsed, elapsed + duration)) return false;

      shot.angle = Math.atan2(waypoint.x - shot.x, shot.y - waypoint.y);
      shot.x = next.x;
      shot.y = next.y;
      shot.distance += duration * velocity;
      shot.trail.push({ x: shot.x, y: shot.y, distance: shot.distance });
      while (shot.trail.length > 2 && shot.trail[1].distance <= shot.distance - 160) shot.trail.shift();
      elapsed += duration;
      if (duration === legDuration) shot.nextPoint++;
    }
    if (shot.nextPoint < shot.waypoints.length) return true;

    this.feedback('miss', shot.roadEntry ? shot : {
      x: Math.max(54, Math.min(field.width - 54, shot.x)),
      y: Math.max(277, Math.min(field.height - 277, shot.y)),
    });
    this.finishIntro(shot);
    return false;
  }

  hitDuring(shot, next, start, end) {
    let target = null;
    let hitTime = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue;
      const from = Math.max(start, enemy.activeFrom);
      const to = Math.min(end, enemy.activeUntil);
      if (from > to) continue;
      const activeDuration = enemy.activeUntil - enemy.activeFrom;
      const enemyFrom = activeDuration ? lerp(enemy.previous, enemy, (from - enemy.activeFrom) / activeDuration) : enemy;
      const enemyTo = activeDuration ? lerp(enemy.previous, enemy, (to - enemy.activeFrom) / activeDuration) : enemy;
      const shotFrom = lerp(shot, next, (from - start) / (end - start));
      const shotTo = lerp(shot, next, (to - start) / (end - start));
      const fraction = contact(shotFrom, shotTo, enemyFrom, enemyTo, this.level.sword.radius + this.level.enemy.radius);
      if (!Number.isFinite(fraction)) continue;
      const t = from + (to - from) * fraction;
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
      this.feedback(target.health <= 0 ? 'kill' : 'hit', lerp(shot, next, (hitTime - start) / (end - start)));
      this.finishIntro(shot);
      return true;
    }
    return false;
  }

  finishIntro(shot) {
    if (shot.id !== this.level.intro.id) return;
    this.formationShown = true;
    for (const sword of this.level.formation) this.addSword(sword);
  }
}
