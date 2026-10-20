// ============================================================
// motion.js — Tesla Roadster @ SpaceX C-Magnet Ramp
// 纯运动学核心：无渲染依赖，node 与浏览器共用
// 阶段 approach → climb → capture → hang → descent → roll → cushion → landed
//
// 坡道: 圆柱面上 a∈[0,π] 的螺旋弧, 扭转 z = 0.5*k*a²
//   a=0   → (0, 0, 0)     地面入口, 切向 +X
//   a=π/2 → (R, R, ·)     C 形右腰
//   a=π   → (0, 2R, ·)    顶点, 切向 -X, 车 180° 完全倒置
// 脱轨后靠车底气垫冷气缓降, 侧向冷气脉冲完成 180° 横滚回正,
// 接近地面时车底高压白雾缓冲, 零速触地
// ============================================================
export const CFG = {
  R: 11.0, k: 1.2, g: 9.81,
  vEntry: 20.0, vStart: 14.0, drag: 0.0030,
  magStart: 0.50, holdTime: 1.0,
  descentA0: 3.40, descentFall: 0.40, vRef: 7.0,
  rollDelay: 0.50, rollDur: 2.90,
  pulseTimes: [0.55, 1.20, 1.85, 2.50], pulseDur: 0.24,
  cushionH: 3.0,
  approachT: 1.00, approachStart: -38,
  halfCar: 0.60, suspA: 0.18, vh: 2.4,     // vh = 脱轨后水平漂移速度
  shake: 0.9,                              // 磁吸锁定震动幅度
};

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const scl = (a, k) => v3(a.x * k, a.y * k, a.z * k);
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const nrm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };
export function rotAxis(v, axis, ang) {
  const k = nrm(axis), c = Math.cos(ang), s = Math.sin(ang);
  return add(add(scl(v, c), scl(cross(k, v), s)), scl(k, dot(k, v) * (1 - c)));
}
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoothstep = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = (x) => { const t = clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// ---------- 坡道几何 ----------
// C 形磁吸坡道：车行于 C 形环的【外缘上表面】
//
// 关键：让 C 形环的"顶点"位于 (0, 2R)，环心在 (0, R)。
// 车压在外缘上，车底磁吸盘贴住轨道【顶面】，车身在轨道【外侧】。
//   a=0   → (0,0) 地面入口，车底贴地，车身正立
//   a=π/2 → (R, R) C形右腰，车身侧躺 90°
//   a=π   → (0, 2R) 顶点 —— 车身在轨道外侧且已翻满 180°，完全倒挂
//
// 几何实现：把"环"反向 —— 用圆心 (0, -R) 的下半圆? 不。
// 直接用参数化圆：
//   轨道点 = 圆心 + R * (sin a, -cos a)
//   圆心 C = (0, R)  →  a=0: (0, 0)   a=π/2: (R, R)   a=π: (0, 2R)  ✓
//   轨道外法向(背离圆心) = (sin a, -cos a)
//   a=0:  (0,-1) 指向下 ✗
// → 说明这个圆弧在 a 增大时是【顺时针】绕圆心，即圆心在弧的【上方】。
//   车压轨道顶面 → 车身在轨道上方 → 车身 = 轨道点 + 外法向*h
//   a=π: 外法向 = (0, 1) → 车身在轨道上方、车顶朝上 = 正立 ✗
//
// 结论：要"车倒挂在下方"，车必须压轨道【底面】，
// 即车身 = 轨道点 - 外法向*h，车顶朝向 = -外法向 = 指向圆心。
//   a=0:  -外法向 = (0, 1) 车顶朝上 ✓ 正立
//   a=π/2: -外法向 = (-1, 0) 车顶朝左 → 车身在轨道【右侧】，侧躺 ✓
//   a=π:  -外法向 = (0, -1) 车顶朝下 ✓ 倒挂！
//   车身位置 a=0: 轨道(0,0) - (0,-1)*0.6 = (0, +0.6) ✓ 贴地
//   车身位置 a=π: 轨道(0,2R) - (0,1)*0.6 = (0, 2R-0.6) 在轨道下方 ✓
//   → 完美：车沿 C 形【内侧】(圆心一侧)跑，到顶点时悬在轨道下方倒挂。
//     这正是"车底吸附风扇把车吸在坡道底面、倒挂静止"的效果。
export const rampPoint = (a) => ({ x: CFG.R * Math.sin(a), y: CFG.R * (1 - Math.cos(a)), z: 0.5 * CFG.k * a * a });
export const rampTangent = (a) => {
  const v = { x: CFG.R * Math.cos(a), y: CFG.R * Math.sin(a), z: CFG.k * a };
  const n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n };
};
/** 车身顶面朝向 = 指向环心（顶点处朝下 = 完全倒挂） */
export const rampUp = (a) => ({ x: -Math.sin(a), y: Math.cos(a), z: 0 });

export function buildTimeline(cfg = CFG) {
  const C = { ...cfg }, R = C.R, dt = 1 / 240;
  const st = [];
  const push = (o) => { o.t = st.length ? st[st.length - 1].t + dt : 0; st.push(o); return o; };
  const spd = (a) => Math.hypot(R * Math.cos(a), R * Math.sin(a), C.k * a);
  const arcLen = (a1, a2) => { let s = 0, p = rampPoint(a1); for (let i = 1; i <= 200; i++) { const q = rampPoint(a1 + (a2 - a1) * i / 200); s += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); p = q; } return s; };

  // ---------- 阶段 0：地面助跑 ----------
  const D = 0 - C.approachStart, v0 = C.vStart, v1 = C.vEntry;
  const acc = (v1 * v1 - v0 * v0) / (2 * D);
  let x = C.approachStart, v = v0, tt = 0;
  while (tt < C.approachT - 1e-9) {
    push({ kind: 'approach', x, y: C.halfCar, z: 0, a: 0, v, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 1, mag: 0, thr: 0.85 });
    x += v * dt; v = Math.min(v1, v + acc * dt); tt += dt;
  }
  const tEnter = st[st.length - 1].t + dt;

  // ---------- 阶段 1：冲上坡道 ----------
  const aMag = Math.PI * C.magStart;
  let a = 0, av = C.vEntry, t1 = 0;
  while (a < aMag - 1e-6 && t1 < 20) {
    const dyds = rampTangent(a).y;
    av = Math.max(0, av + (-C.g * dyds - C.drag * av * av) * dt);
    a += (av / spd(a)) * dt; t1 += dt;
    push({ kind: 'climb', x: 0, y: 0, z: 0, a, v: av, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 1 - dyds, mag: 0, thr: 0.3 });
  }
  const vCap = av, aCap = a;

  // ---------- 阶段 2：磁吸等减速捕获 → 顶部 180° 倒挂静止 ----------
  const dCap = arcLen(aCap, Math.PI);
  const cMag = Math.max(0.8, (vCap * vCap) / (2 * dCap));
  let capV = vCap, capA = aCap, capT = 0;
  while (capT < vCap / cMag + 1e-9) {
    const dyds = rampTangent(capA).y;
    const shake = capV < 2.2 ? C.shake * Math.sin(capT * 42) * (capV / 2.2) : 0;
    push({ kind: capV < 0.25 ? 'hang' : 'capture', x: 0, y: 0, z: 0, a: capA, v: capV, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: shake, gLoad: -(cMag + C.g * dyds) / C.g, mag: 1, thr: 0 });
    capV = Math.max(0, capV - cMag * dt);
    capA += (capV / spd(capA)) * dt;
    capT += dt;
    if (capA >= Math.PI) { capA = Math.PI; break; }
  }
  for (let i = 0; i < Math.round(C.holdTime / dt); i++)
    push({ kind: 'hang', x: 0, y: 0, z: 0, a: Math.PI, v: 0, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 0, mag: 1, thr: 0 });
  const tRelease = st[st.length - 1].t + dt;

  // ---------- 阶段 3：脱轨自由运动 ----------
  const apex = rampPoint(Math.PI);
  const fwd0 = rampTangent(Math.PI);
  const up0 = rampUp(Math.PI);
  const y0 = apex.y - C.halfCar;
  let y = y0, vy = 0, tl = 0, roll = 0, mist = 0;
  let px = apex.x, pz = apex.z;
  const vhx = fwd0.x * C.vh, vhz = fwd0.z * C.vh;
  const freeStart = st.length;
  let tTouch = 0;
  while (tl < 24) {
    const h = y - C.halfCar;
    let aAcc, kind, thr;
    if (h <= C.cushionH && vy > 0.02) {
      // 气垫缓冲：按剩余高度连续反解所需减速度 → 零速触地
      aAcc = -(vy * vy) / (2 * Math.max(0.12, h));
      kind = 'cushion'; thr = 1.0;
      mist = smoothstep(1 - h / C.cushionH);
    } else {
      // 反推喷口：推力随速度上升 → 净下压加速度衰减
      const net = C.descentA0 * (1 - C.descentFall * clamp(vy / C.vRef, 0, 1));
      aAcc = net;
      kind = (tl < C.rollDelay) ? 'descent' : 'roll';
      thr = 1 - net / C.g; mist = 0;
    }
    const ru = (tl - C.rollDelay) / C.rollDur;
    roll = easeInOut(ru) * Math.PI;
    let pl = 0;
    for (const pt of C.pulseTimes) { const d = tl - pt; if (d >= 0 && d < C.pulseDur) pl = Math.max(pl, Math.sin(Math.PI * d / C.pulseDur) ** 2); }
    push({ kind, x: px, y, z: pz, a: 0, v: 0, vy, roll, mist, jet: 0, pulse: pl, susp: 0, gLoad: 1 - aAcc / C.g, mag: 0, thr });
    vy += aAcc * dt;
    y -= vy * dt;
    px += vhx * dt; pz += vhz * dt;
    tl += dt;
    if (y <= C.halfCar) { y = C.halfCar; vy = 0; tTouch = tl; break; }
  }
  const tLand = st[freeStart].t + tTouch;
  for (let i = 0; i < Math.round(2.6 / dt); i++) {
    const lt = i * dt;
    push({ kind: 'landed', x: px, y: C.halfCar, z: pz, a: 0, v: 0, vy: 0, roll: Math.PI, mist: Math.max(0, 1 - lt / 1.1), jet: 0, pulse: 0, susp: C.suspA * Math.exp(-6.0 * lt) * Math.cos(13 * lt), gLoad: 1, mag: 0, thr: 0 });
  }

  // ---------- 采样 ----------
  function sample(tq) {
    const t = clamp(tq, 0, st[st.length - 1].t);
    let lo = 0, hi = st.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (st[mid].t <= t) lo = mid + 1; else hi = mid; }
    const s = st[Math.min(st.length - 1, lo)];
    const o = {
      t, phase: s.kind, a: s.a, speed: s.v, mag: s.mag, mist: s.mist, pulse: s.pulse,
      susp: s.susp || 0, gLoad: s.gLoad, thr: s.thr, jet: 0, roll: 0, pitch: 0, height: 0,
      x: s.x, y: s.y, z: s.z, fwd: v3(1, 0, 0), up: v3(0, 1, 0), right: v3(0, 0, -1),
    };
    if (s.kind === 'approach') {
      o.fwd = v3(1, 0, 0); o.up = v3(0, 1, 0); o.right = v3(0, 0, -1);
      o.speed = s.v; o.height = 0;
      return o;
    }
    if (s.kind === 'climb' || s.kind === 'capture' || s.kind === 'hang') {
      const p = rampPoint(s.a), T = rampTangent(s.a), U = rampUp(s.a);
      o.x = p.x + U.x * C.halfCar; o.y = p.y + U.y * C.halfCar; o.z = p.z + U.z * C.halfCar;
      o.fwd = T; o.up = U; o.right = nrm(cross(U, T));
      o.height = o.y; o.pitch = Math.asin(clamp(T.y, -1, 1)) * 180 / Math.PI;
      o.roll = 0; o.speed = s.v;
      return o;
    }
    const fallF = clamp(1 - (s.y - C.halfCar) / (y0 - C.halfCar), 0, 1);
    o.fwd = nrm(v3(fwd0.x, fwd0.y - 0.10 * fallF, fwd0.z));
    o.up = rotAxis(up0, o.fwd, s.roll);
    o.right = nrm(cross(o.up, o.fwd));
    o.roll = s.roll * 180 / Math.PI;
    o.speed = Math.abs(s.vy);
    o.height = s.y - C.halfCar;
    o.jet = s.kind === 'cushion' ? 1.0 : 0.9;
    o.pulse = s.pulse;
    return o;
  }
  return { cfg: C, sample, st, TOTAL: st[st.length - 1].t, times: { tEnter, tRelease, tLand, vCap, dCap, cMag, y0 }, apex, fwd0, up0 };
}
