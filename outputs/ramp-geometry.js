// ============================================================
// ramp-geometry.js — C 形磁吸坡道的【共享】几何定义
//
// 渲染层与运动学层必须使用同一份公式，否则车会与坡道错位。
// 本模块无任何渲染依赖，可在 node 与浏览器中直接 import。
//
// 坐标系约定（右手系，Y 向上）：
//   环心 C = (0, R)，坡道走 C 形环的【内侧】(凹面)
//   参数 a ∈ [0, π]
//     a = 0    → (0, 0, 0)      地面入口，切向 +X，车身正立
//     a = π/2  → (R, R, ·)      C 形右腰，切向 +Y，车身侧躺 90°
//     a = π    → (0, 2R, ·)     顶点，切向 −X，车身完全倒置 180°
//   横向扭转 z = ½·k·a²，让脱轨后产生侧向漂移
//
// 关键约定：
//   rampUp(a) = 指向环心的法向 = 车身【顶面】朝向
//   → a=π 时 rampUp = (0,−1,0)，车顶朝下，车悬于轨道下方倒挂
//   车身中心 = rampPoint(a) + rampUp(a)·halfCar
//   车身底面 = rampPoint(a) + rampUp(a)·(halfCar − carHeight/2)
// ============================================================

/** 车辆几何常量（与渲染层 buildCar 保持一致） */
export const CAR = {
  length: 4.2,      // 车身总长 (m)，局部 X 从 -2.05 到 +2.16
  width: 1.36,      // 车身总宽 (m)，局部 Z ±0.68
  height: 0.72,     // 车身总高 (m)，局部 Y 从 -0.40 到 +0.32
  wheelRadius: 0.30,
  wheelBase: 2.68,  // 前后轮距 (m)
  track: 1.28,      // 左右轮距 (m)
  /** 车身中心到【轮胎最低点】的距离（地面行驶时的离地高） */
  get rideHeight() { return 0.28 + this.wheelRadius; },  // 0.58
  /** 车身中心到【磁吸盘贴合面】的距离 —— 磁吸时真正接触坡道的面 */
  get magContact() { return 0.385; },
  /** 车身中心到【车底最低面】的距离（扩散器下沿） */
  get floorClearance() { return 0.40; },
};

/** 坡道参数 */
export const RAMP = { R: 11.0, k: 1.2 };

/**
 * 坡道【基准环点】—— 圆心在 (0,R) 的 C 形环上的点。
 * 注意：这是几何基准，不是车行面。车行面见 rampSurface()。
 */
export function rampPoint(a, R = RAMP.R, k = RAMP.k) {
  return { x: R * Math.sin(a), y: R * (1 - Math.cos(a)), z: 0.5 * k * a * a };
}

/**
 * 车行面（车辆实际压住的那一面轨道）。
 *
 * 关键几何：车沿环的【内侧】行驶，rampUp 指向环心 = 车身顶面朝向，
 * 因此车底朝【背离环心】的方向。车辆压住的是环的【外缘背面】。
 *   a=0   → 路面在环心下方 → 车辆正立在地面上
 *   a=π/2 → 路面在环心右侧 → 车辆侧躺
 *   a=π   → 路面在环心上方 → 车辆完全倒挂，车底朝上压住路面
 *
 * offset 为轨道半厚（路面相对基准环点向背离环心方向的偏移）。
 */
export function rampSurface(a, offset = 0, R = RAMP.R, k = RAMP.k) {
  const p = rampPoint(a, R, k);
  const u = rampUp(a);
  return { x: p.x - u.x * offset, y: p.y - u.y * offset, z: p.z - u.z * offset };
}

/** 坡道单位切向（前进方向） */
export function rampTangent(a, R = RAMP.R, k = RAMP.k) {
  const v = { x: R * Math.cos(a), y: R * Math.sin(a), z: k * a };
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/** 坡道法向 = 指向环心 = 车身顶面朝向 */
export function rampUp(a) {
  return { x: -Math.sin(a), y: Math.cos(a), z: 0 };
}

/** 坡道横向单位向量（宽度方向） */
export function rampSide(a, R = RAMP.R, k = RAMP.k) {
  const u = rampUp(a);
  const t = rampTangent(a, R, k);
  // side = up × tangent，与 up/tangent 正交
  // 方向约定与 makeCarBasis 的 zAxis = cross(up, fwd) 一致
  return nrm(cross(u, t));
}

/** |dP/da| —— 参数化速度，用于把弧长换算成参数增量 */
export function rampParamSpeed(a, R = RAMP.R, k = RAMP.k) {
  return Math.hypot(R * Math.cos(a), R * Math.sin(a), k * a);
}

/** 坡道弧长 a1→a2 */
export function rampArcLength(a1, a2, R = RAMP.R, k = RAMP.k, steps = 400) {
  let s = 0;
  let p = rampPoint(a1, R, k);
  for (let i = 1; i <= steps; i++) {
    const q = rampPoint(a1 + (a2 - a1) * i / steps, R, k);
    s += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    p = q;
  }
  return s;
}

/** 车身中心位置（贴轨面行驶时） */
export function carCenterOnRamp(a, halfCar, R = RAMP.R, k = RAMP.k) {
  const p = rampPoint(a, R, k);
  const u = rampUp(a);
  return { x: p.x + u.x * halfCar, y: p.y + u.y * halfCar, z: p.z + u.z * halfCar };
}

// ---------- 向量工具 ----------
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scl = (a, k) => v3(a.x * k, a.y * k, a.z * k);
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const nrm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoothstep = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = (x) => { const t = clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/** 罗德里格斯旋转：绕单位轴旋转 ang 弧度 */
export function rotAxis(v, axis, ang) {
  const k = nrm(axis), c = Math.cos(ang), s = Math.sin(ang);
  return add(add(scl(v, c), scl(cross(k, v), s)), scl(k, dot(k, v) * (1 - c)));
}

/**
 * 由前进方向与车顶方向构造正交姿态基。
 *
 * 【坐标系约定 —— 与 buildCar 模型局部轴严格对应】
 *   模型局部 +X = 车长轴（车头在 −X，车尾在 +X）
 *   模型局部 +Y = 车顶方向
 *   模型局部 +Z = 车宽轴（车轮轴）
 *
 * 因此 makeBasis 的三列必须依次为：
 *   第一列 = 车头朝外方向  =  −fwd   （模型 +X 指向车尾）
 *   第二列 = 车顶方向      =   up
 *   第三列 = 车宽轴        =   right = up × fwd
 *
 * 校验：det = (−fwd) · (up × right) 必须为 +1（纯旋转）。
 */
export function makeCarBasis(fwd, up) {
  const f = nrm(fwd);
  // 重新正交化：u ⟂ f
  let u = nrm(up);
  u = nrm(sub(u, scl(f, dot(u, f))));

  // 宽轴（模型局部 +Z = 车轮轴）
  //   模型要求 det(xAxis, up, zAxis) = +1（纯旋转）
  //   xAxis = −fwd（模型 +X 指向车尾）
  //   ⇒ det(−f, u, z) = +1 ⇒ z = u × f
  //   （若取 z = f × u 则 det = −1，得到镜像矩阵，反射不可用）
  const zAxis = nrm(cross(u, f));
  // 由 zAxis 与 fwd 重建 up，保证三者严格正交
  //   z = u × f  ⇒  u = f × z
  const up2 = nrm(cross(f, zAxis));

  return { fwd: f, up: up2, right: zAxis, xAxis: scl(f, -1) };
}
