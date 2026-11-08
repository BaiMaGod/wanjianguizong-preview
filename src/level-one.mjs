export const field = { width: 941, height: 1672 };

export const directions = {
  up: { x: 0, y: -1, angle: 0, label: '上' },
  right: { x: 1, y: 0, angle: 90, label: '右' },
  down: { x: 0, y: 1, angle: 180, label: '下' },
  left: { x: -1, y: 0, angle: 270, label: '左' },
};

export const levelOne = {
  number: 1,
  name: '初试剑阵',
  health: 3,
  talismans: 1,
  hero: { x: 111, y: 405 },
  columns: [151, 270, 389, 508, 627, 746],
  rows: [504, 600, 696, 792, 888, 984, 1080],
  route: [
    [286, 277], [800, 277], [827, 283], [849, 299], [863, 322], [868, 349],
    [868, 1191], [862, 1218], [846, 1242], [823, 1256], [796, 1261],
    [125, 1261], [97, 1255], [74, 1239], [59, 1216], [54, 1188], [54, 416],
  ],
  sword: { damage: 10, speed: 2000, routeSpeed: 1050, radius: 12 },
  enemy: { health: 10, baseSpeed: 300, speedScale: 0.5, radius: 31, leakDamage: 1 },
  cast: { moveMin: 0.12, moveMax: 0.22, charge: 0.13, return: 0.18 },
  comboWindow: 2,
  intro: { id: 'intro', col: 4, row: 1, direction: 'up' },
  formation: [
    { id: 'rear', col: 2, row: 3, direction: 'right' },
    { id: 'front', col: 4, row: 3, direction: 'right' },
    { id: 'north-west', col: 2, row: 0, direction: 'up' },
    { id: 'north-east', col: 5, row: 1, direction: 'up' },
    { id: 'south-west', col: 0, row: 4, direction: 'down' },
    { id: 'south-east', col: 5, row: 4, direction: 'down' },
    { id: 'west-rear', col: 3, row: 5, direction: 'left' },
    { id: 'west-front', col: 1, row: 5, direction: 'left' },
  ],
  waves: [[3], [9, 11.4], [16, 18.6]],
};
