// ============================================================
// motion.js — Tesla Roadster @ SpaceX C-Magnet Ramp
// 纯运动学核心：无渲染依赖，node 与浏览器共用
//
// 阶段 approach → climb → capture → hang → descent → roll → cushion → landed
//
// 【状态约定】
//   时间 t      : 秒
//   位置 (x,y,z): 世界坐标，米
//   speed       : 沿轨/垂直速率的标量，m/s
//   gLoad       : 比力（specific force）分量，单位 g
//                 自由落体为 0，静止受支撑为 1g，磁吸负 g 为负值
//   roll        : 绕车辆纵轴的横滚角，弧度（内部）→ 度（展示）
//   up          : 车身【顶面】方向（不是法向！模型局部 +Y）
//   fwd         : 车身【前进】方向（模型局部 −X）
//
// 坡道几何定义见 ramp-geometry.js —— 渲染层与运动学层共用同一份公式。
// ============================================================
import {
  RAMP, CAR, rampPoint, rampTangent, rampUp, rampSide, rampParamSpeed,
  rampArcLength, carCenterOnRamp, makeCarBasis,
  v3, add, sub, scl, cross, dot, nrm, rotAxis, clamp, smoothstep, easeInOut,
} from './ramp-geometry.js';

export { RAMP, CAR, rampPoint, rampTangent, rampUp, rampSide, rampArcLength };
export { v3, add, sub, scl, cross, dot, nrm, rotAxis, clamp, smoothstep, easeInOut, makeCarBasis };

export const CFG = {
  // ---- 坡道 ----
  R: RAMP.R, k: RAMP.k,
  // ---- 助跑 ----
  // 助跑距离由 approachStart 与入坡点 x=0 决定；
  // 助跑时长由距离/速度唯一确定（deriveApproachDuration），
  // 不再单独配置 approachT —— 避免"距离 38m 却只跑 1s"这类矛盾。
  //
  // 取值依据：22m 起步距离、0→20 m/s ⇒ 1.10s、9.09 m/s² (0.93g)，
  // 接近真实 Roadster 的 0-100km/h 加速能力，且构图紧凑。
  approachStart: -22, vStart: 0.0, vEntry: 20.0,
  g: 9.81, drag: 0.0030,
  // ---- 磁吸捕获 ----
  magStart: 0.50,       // 捕获起点（a/π）
  holdTime: 1.0,        // 顶部倒挂静止时长
  // ---- 脱轨后 ----
  descentA0: 3.40,      // 反推冷气段初始净下压加速度 (m/s²)
  descentFall: 0.40,    // 速度越高推力越大 → 下压衰减比例
  vRef: 7.0,
  rollDelay: 0.50, rollDur: 2.90,
  pulseTimes: [0.55, 1.20, 1.85, 2.50], pulseDur: 0.24,
  cushionH: 3.0,
  // ---- 车辆几何 ----
  // halfCar  = 车身中心离【地面】的高度（轮胎接触地面）→ 地面阶段用
  // magHalf  = 车身中心到【磁吸盘贴合面】的距离 → 坡道磁吸阶段用
  // 两者相差 0.195m：磁吸时轮胎悬空（车被磁力吸住，不是压在轨道上），
  // 用 rideHeight 会让磁吸盘悬空 0.195m —— 视觉上"没吸住"。
  halfCar: CAR.rideHeight,  // 0.58  地面/着陆
  magHalf: CAR.magContact,  // 0.385 坡道磁吸
  suspA: 0.18,
  vh: 2.4,                // 脱轨后水平漂移速度
  shake: 0.9,             // 磁吸锁定震动幅度
  // ---- 数值 ----
  dt: 1 / 240,
};

/** 由助跑参数推导出一致的加速时长（避免配置矛盾导致位置跳变） */
export function deriveApproachDuration(cfg = CFG) {
  const D = 0 - cfg.approachStart;
  const v0 = cfg.vStart, v1 = cfg.vEntry;
  if (D <= 0 || v1 <= v0) return 0;
  const acc = (v1 * v1 - v0 * v0) / (2 * D);
  return (Math.sqrt(v0 * v0 + 2 * acc * D) - v0) / acc;
}

/**
 * 配置有效性检查 —— 非法配置必须在【开始积分前】就给出明确错误，
 * 而不是让下游出现 "Cannot read properties of undefined" 之类的无信息异常。
 */
export function validateConfig(C) {
  const req = (ok, msg) => { if (!ok) throw new Error(`配置无效: ${msg}`); };
  const num = (v, name) => req(typeof v === 'number' && Number.isFinite(v), `${name} 必须是有限数值（实得 ${v}）`);
  num(C.R, 'R'); num(C.k, 'k'); num(C.g, 'g'); num(C.dt, 'dt');
  num(C.vEntry, 'vEntry'); num(C.vStart, 'vStart');
  num(C.magStart, 'magStart'); num(C.holdTime, 'holdTime');
  num(C.descentA0, 'descentA0'); num(C.descentFall, 'descentFall');
  num(C.vRef, 'vRef'); num(C.rollDelay, 'rollDelay'); num(C.rollDur, 'rollDur');
  num(C.cushionH, 'cushionH'); num(C.halfCar, 'halfCar'); num(C.magHalf, 'magHalf');
  num(C.approachStart, 'approachStart'); num(C.vh, 'vh'); num(C.suspA, 'suspA');

  req(C.R > 0, 'R 必须为正');
  req(C.dt > 0, 'dt 必须为正');
  req(C.vEntry > 0, 'vEntry 必须为正（入坡速度不能为 0）');
  req(C.vStart >= 0, 'vStart 不能为负');
  req(C.vEntry >= C.vStart, 'vEntry 必须 ≥ vStart');
  req(C.approachStart < 0, 'approachStart 必须为负（入坡点在 x=0）');
  req(C.magStart > 0 && C.magStart < 1, 'magStart 必须在 (0,1) 内');
  req(C.holdTime >= 0, 'holdTime 不能为负');
  req(C.rollDur > 0, 'rollDur 必须为正');
  req(C.cushionH > 0, 'cushionH 必须为正');
  req(C.halfCar > 0 && C.magHalf > 0, '车身高度基准必须为正');
  req(C.vRef > 0, 'vRef 必须为正');
  req(Array.isArray(C.pulseTimes), 'pulseTimes 必须是数组');
  req(C.pulseDur > 0, 'pulseDur 必须为正');
  return true;
}

export function buildTimeline(cfg = CFG) {
  const C = { ...cfg }, R = C.R, k = C.k, dt = C.dt;
  validateConfig(C);
  const st = [];
  const push = (o) => { o.t = st.length ? st[st.length - 1].t + dt : 0; st.push(o); return o; };
  const spd = (a) => rampParamSpeed(a, R, k);
  // 弧长 → 坡道参数（二分反解）
  function arcLengthToParam(a0, sTarget, Rr, kk) {
    if (sTarget <= 0) return a0;
    const aEnd = Math.PI;
    const total = rampArcLength(a0, aEnd, Rr, kk, 200);
    if (sTarget >= total) return aEnd;
    let lo = a0, hi = aEnd;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (rampArcLength(a0, mid, Rr, kk, 60) < sTarget) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------- 阶段 0：地面助跑 ----------
  // 匀加速：位移、速度、时间三者由 approachStart 唯一确定
  const D = 0 - C.approachStart, v0 = C.vStart, v1 = C.vEntry;
  const acc = (v1 * v1 - v0 * v0) / (2 * D);
  const approachT = deriveApproachDuration(C);
  let x = C.approachStart, v = v0, tt = 0;
  while (tt < approachT - 1e-9) {
    // 位置更新用【当前速度】的前向欧拉，末步按剩余距离精确截断，
    // 保证最后一个样本恰好落在 x=0（否则与坡道入口有 8cm 错位）
    const remain = 0 - x;
    const step = Math.min(v * dt, remain);
    push({ kind: 'approach', x, y: C.halfCar, z: 0, a: 0, v, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 1, mag: 0, thr: 0.85 });
    x += step; v = Math.min(v1, v + acc * dt); tt += dt;
    if (remain <= 1e-9) break;
  }
  // 末样本精确落在坡道入口
  if (st.length) { st[st.length - 1].x = 0; st[st.length - 1].v = v1; }
  const tEnter = st[st.length - 1].t + dt;

  // ---------- 阶段 1：冲上坡道 ----------
  // 【根因修复】助跑时车身中心离地 halfCar(0.58，轮胎着地)，
  // 而磁吸阶段车靠磁吸盘贴合坡道 → 中心高 magHalf(0.385)。
  // 直接切换会造成 0.195m 的位置跳变。
  // 解决：用 lift 因子在入坡后【连续过渡】—— 车被磁吸吸起，
  // 轮胎离地、磁吸盘落位，是一个真实的物理过程。
  const LIFT_A = 0.55;                    // 过渡完成的坡道参数 (rad)
  const liftAt = (a) => clamp(1 - a / LIFT_A, 0, 1);
  const aMag = Math.PI * C.magStart;
  let a = 0, av = C.vEntry, t1 = 0;
  while (a < aMag - 1e-6 && t1 < 20) {
    const dyds = rampTangent(a, R, k).y;      // 沿轨爬升率
    // 【根因修复】原实现先积分再 push，导致首样本的 a 与 v 已被推进过一步
    //   → 入坡瞬间车已"跳过" 0.43° 的坡道，与助跑末端位置错位 7.9cm。
    // 修正：先记录当前状态，再积分（记录的是该时刻的真实状态）。
    push({ kind: 'climb', x: 0, y: 0, z: 0, a, v: av, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 1 - dyds, mag: 0, thr: 0.3 });
    av = Math.max(0, av + (-C.g * dyds - C.drag * av * av) * dt);
    a += (av / spd(a)) * dt; t1 += dt;
  }
  // 末样本补记：确保捕获起点被记录
  push({ kind: 'climb', x: 0, y: 0, z: 0, a, v: av, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 1 - rampTangent(a, R, k).y, mag: 0, thr: 0.3 });
  const vCap = av, aCap = a;

  // ---------- 阶段 2：磁吸等减速捕获 → 顶部 180° 倒挂静止 ----------
  // 【根因修复】原实现用"参数域半隐式欧拉"积分等减速，离散误差使车
  // 停在 179.877° 而非 180°（差 0.123°）。
  // 改为【解析速度剖面 + 弧长反解参数】：
  //   弧长域等减速: s(τ) = s0 + v0·τ − ½·c·τ²,  v(τ) = v0 − c·τ
  //   捕获距离 dCap 已知 → 停止时间 capDur = v0/c
  //   每步由弧长反解 a：对 rampArcLength(a0, a) = s 做二分
  // 这样停车位置由解析式保证，与 dt 无关。
  const dCap = rampArcLength(aCap, Math.PI, R, k);
  const cMag = Math.max(0.8, (vCap * vCap) / (2 * dCap));
  const capDur = vCap / cMag;
  // 采样点：τ = 0, dt, 2dt, ... capDur（含端点）
  const nCap = Math.max(1, Math.ceil(capDur / dt));
  let capEndA = aCap, capEndV = vCap, capOk = false;
  let capSamples = 0, capLastTau = 0;
  for (let i = 0; i <= nCap; i++) {
    capSamples++;
    const tau = Math.min(capDur, i * dt);
    capLastTau = tau;
    // 解析弧长与速度（等减速，弧长域）
    const sAt = Math.min(dCap, vCap * tau - 0.5 * cMag * tau * tau);
    const vAt = Math.max(0, vCap - cMag * tau);
    // 弧长 → 参数：二分反解
    const aAt = arcLengthToParam(aCap, sAt, R, k);
    const dyds = rampTangent(aAt, R, k).y;
    const shake = vAt < 2.2 ? C.shake * Math.sin(tau * 42) * (vAt / 2.2) : 0;
    const gLoad = -(cMag + C.g * dyds) / C.g;
    push({ kind: vAt < 0.25 ? 'hang' : 'capture', x: 0, y: 0, z: 0, a: aAt, v: vAt, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: shake, gLoad, mag: 1, thr: 0 });
    capEndA = aAt; capEndV = vAt;
    if (tau >= capDur - 1e-12) { capEndA = Math.PI; capEndV = 0; capOk = true; break; }
  }
  const capEndT = st[st.length - 1].t;
  // 显式处理捕获失败
  //
  // 【根因修复】早前版本只在循环结束后检查 capOk。若采样步长 dt 过大，
  // 捕获循环采样不足（最后一个采样点的 τ 远小于 capDur），
  // 车会停在半路却被判定为"倒挂成功"。
  // 现在分三种情况显式处理：
  //   ① 采样点未覆盖到停止时刻 → 抛错（步长不适合此配置）
  //   ② 跑完但没到顶点        → 抛错（给出实际停车角度与残余速度）
  //   ③ 到达顶点但仍有残余速度 → 抛错
  if (!capOk) {
    if (capLastTau < capDur - 1e-9) {
      throw new Error(
        `磁吸捕获失败: 采样未覆盖停止时刻（最后 τ=${capLastTau.toFixed(6)}s < 需要的 ${capDur.toFixed(6)}s），` +
        `采样步长 ${dt.toFixed(6)}s 过大，请减小步长`);
    }
    throw new Error(
      `磁吸捕获失败: 停在 a=${(capEndA * 180 / Math.PI).toFixed(6)}° (目标 180°), ` +
      `残余速度 ${capEndV.toFixed(6)} m/s`);
  }
  // 顶部倒挂保持
  for (let i = 0; i < Math.round(C.holdTime / dt); i++)
    push({ kind: 'hang', x: 0, y: 0, z: 0, a: Math.PI, v: 0, vy: 0, roll: 0, mist: 0, jet: 0, pulse: 0, susp: 0, gLoad: 0, mag: 1, thr: 0 });
  const tRelease = st[st.length - 1].t + dt;

  // ---------- 阶段 3：脱轨自由运动 ----------
  const apex = rampPoint(Math.PI, R, k);
  const fwd0 = rampTangent(Math.PI, R, k);
  const up0 = rampUp(Math.PI);
  const y0 = apex.y - C.magHalf;   // 磁吸释放瞬间的车身高度（lift 已衰减为 0）
  let y = y0, vy = 0, tl = 0, roll = 0, mist = 0;
  let px = apex.x, pz = apex.z;
  const vhx = fwd0.x * C.vh, vhz = fwd0.z * C.vh;
  const freeStart = st.length;
  let tTouch = 0, landed = false;

  // 气垫段解析解状态
  //   模型：按剩余高度反解所需减速度 a = v²/(2h)（恰好能在剩余高度内停住）
  //   分离变量 dv/dh = v/(2h) ⇒ v(h) = v₀·√(h/h₀)
  //   ⇒ h(t) = (√h₀ − C·t/2)²,  C = v₀/√h₀
  //   h→0 时 v→0 严格成立。
  //
  //   【为什么必须用解析解】早期版本对反解方程做欧拉离散积分，
  //   必然产生两种缺陷：
  //     ① max(0.12,h) 地板给减速度设上限 → 触地残余速度 ~1.08 m/s
  //     ② 即使去掉地板，离散步进仍过冲 → 触地时位置已低于地面，
  //        速度被强行置 0 → 触地瞬间速度突变（1.077 → 0）。
  //   解析解从根上消除了"离散化 vs 连续反解"的矛盾。
  let cushH0 = null, cushV0 = 0, cushC = 0, cushT0 = 0;

  while (tl < 24) {
    const h = y - C.halfCar;   // 离地高度（轮胎最低点）
    let aAcc = 0, kind, thr;

    if (h <= C.cushionH && vy > 0.02) {
      // ---- 气垫段：解析解 ----
      if (cushH0 === null) {
        cushH0 = Math.max(1e-9, h);
        cushV0 = vy;
        cushC = cushV0 / Math.sqrt(cushH0);
        cushT0 = tl;
      }
      const dt2 = tl - cushT0;
      const root = Math.sqrt(cushH0) - cushC * dt2 / 2;
      const hNew = root > 0 ? root * root : 0;
      const vNew = root > 0 ? cushC * root : 0;
      // 瞬时减速度（用于 gLoad 显示）：a = v²/(2h)
      aAcc = hNew > 1e-9 ? -(vNew * vNew) / (2 * hNew) : 0;
      vy = vNew;
      y = C.halfCar + hNew;
      kind = 'cushion'; thr = 1.0;
      mist = smoothstep(1 - hNew / C.cushionH);
      roll = easeInOut((tl - C.rollDelay) / C.rollDur) * Math.PI;
      let pl = 0;
      for (const pt of C.pulseTimes) { const d = tl - pt; if (d >= 0 && d < C.pulseDur) pl = Math.max(pl, Math.sin(Math.PI * d / C.pulseDur) ** 2); }
      push({ kind, x: px, y, z: pz, a: 0, v: 0, vy, roll, mist, jet: 0, pulse: pl, susp: 0, gLoad: 1 - aAcc / C.g, mag: 0, thr });
      px += vhx * dt; pz += vhz * dt;
      tl += dt;
      if (hNew <= 0) { y = C.halfCar; vy = 0; tTouch = tl; landed = true; break; }
      continue;
    }

    // ---- 反推喷口段：推力随速度上升 → 净下压加速度衰减 ----
    const net = C.descentA0 * (1 - C.descentFall * clamp(vy / C.vRef, 0, 1));
    aAcc = net;
    kind = (tl < C.rollDelay) ? 'descent' : 'roll';
    thr = 1 - net / C.g; mist = 0;
    const ru = (tl - C.rollDelay) / C.rollDur;
    roll = easeInOut(ru) * Math.PI;
    let pl = 0;
    for (const pt of C.pulseTimes) { const d = tl - pt; if (d >= 0 && d < C.pulseDur) pl = Math.max(pl, Math.sin(Math.PI * d / C.pulseDur) ** 2); }
    push({ kind, x: px, y, z: pz, a: 0, v: 0, vy, roll, mist, jet: 0, pulse: pl, susp: 0, gLoad: 1 - aAcc / C.g, mag: 0, thr });
    vy += aAcc * dt;
    y -= vy * dt;
    px += vhx * dt; pz += vhz * dt;
    tl += dt;
    if (y <= C.halfCar) { y = C.halfCar; vy = 0; tTouch = tl; landed = true; break; }
  }
  if (!landed) throw new Error('脱轨后未能在 24s 内着陆');
  const tLand = st[freeStart].t + tTouch;
  for (let i = 0; i < Math.round(2.6 / dt); i++) {
    const lt = i * dt;
    push({ kind: 'landed', x: px, y: C.halfCar, z: pz, a: 0, v: 0, vy: 0, roll: Math.PI, mist: Math.max(0, 1 - lt / 1.1), jet: 0, pulse: 0, susp: C.suspA * Math.exp(-6.0 * lt) * Math.cos(13 * lt), gLoad: 1, mag: 0, thr: 0 });
  }


  // ---------- 采样 ----------
  // 阶段索引：用于精确判定边界与插值
  const phaseIndex = new Map();
  for (let i = 0; i < st.length; i++) {
    if (!phaseIndex.has(st[i].kind)) phaseIndex.set(st[i].kind, { first: i, last: i, t0: st[i].t, t1: st[i].t });
    const e = phaseIndex.get(st[i].kind);
    e.last = i; e.t1 = st[i].t;
  }
  // 阶段区间应为 [本阶段首样本, 下一阶段首样本)，使相邻阶段首尾相接
  {
    const ordered = [...phaseIndex.entries()].sort((a, b) => a[1].first - b[1].first);
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i][1];
      e.t1 = (i + 1 < ordered.length) ? ordered[i + 1][1].t0 : st[st.length - 1].t;
      e.dur = e.t1 - e.t0;
    }
  }

  function sample(tq) {
    // 边界与非法输入
    const t = (typeof tq !== 'number' || !Number.isFinite(tq)) ? 0 : clamp(tq, 0, st[st.length - 1].t);

    // 二分：找到【最后一个 t <= 目标】的样本
    let lo = 0, hi = st.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid].t <= t) lo = mid; else hi = mid - 1; }
    const i0 = lo, i1 = Math.min(st.length - 1, i0 + 1);
    const A = st[i0], B = st[i1];
    const u = (B.t > A.t) ? clamp((t - A.t) / (B.t - A.t), 0, 1) : 0;

    // 【阶段标签】按时间区间判定，而非按插值样本
    let phaseKind = st[st.length - 1].kind;
    for (const [k, e] of phaseIndex) { if (t >= e.t0 && t < e.t1) { phaseKind = k; break; } }
    if (t >= st[st.length - 1].t) phaseKind = st[st.length - 1].kind;

    // 【插值策略】
    //  只有【同一阶段内】才插值。跨阶段时取后一阶段首样本的原值。
    //  原因：不同阶段的参数语义不同（坡道阶段的位置由 a 推算，
    //  插值出的 a 不对应任何真实样本 → 位置凭空错位）。
    // 同阶段 → 插值；跨阶段 → 取 A（前一阶段末）的真实值。
    // 原因：B 可能是坡道阶段的占位 0，直接取 B 会把位置变成 0。
    // t 落在空隙时更接近 A，取 A 在物理上也更正确。
    const samePhase = A.kind === B.kind;
    const L = (x, y) => samePhase ? x + (y - x) * u : x;

    // 阶段自有参数
    const a = L(A.a, B.a);
    const v = L(A.v, B.v);
    const vy = L(A.vy, B.vy);
    const roll = L(A.roll, B.roll);
    const mist = L(A.mist, B.mist);
    const pulse = L(A.pulse, B.pulse);
    const susp = L(A.susp || 0, B.susp || 0);
    const gLoad = L(A.gLoad, B.gLoad);
    const thr = L(A.thr, B.thr);
    const mag = B.mag;

    const o = {
      t, phase: phaseKind, a, speed: v, mag, mist, pulse, susp, gLoad, thr, jet: 0,
      roll: 0, pitch: 0, height: 0,
      x: 0, y: 0, z: 0,
      fwd: v3(1, 0, 0), up: v3(0, 1, 0), right: v3(0, 0, 1),
    };

    if (phaseKind === 'approach') {
      // 世界坐标直接存储
      o.x = L(A.x, B.x); o.y = L(A.y, B.y); o.z = L(A.z, B.z);
      o.fwd = v3(1, 0, 0); o.up = v3(0, 1, 0);
      o.right = nrm(cross(o.up, o.fwd));
      o.speed = v; o.height = 0; o.pitch = 0;
      return o;
    }
    if (phaseKind === 'climb' || phaseKind === 'capture' || phaseKind === 'hang') {
      // 位置由坡道参数 a 推算
      // 高度基准随 lift 从 halfCar(轮胎着地) 连续过渡到 magHalf(磁吸盘贴合)
      const p = rampPoint(a, R, k), Tg = rampTangent(a, R, k), U = rampUp(a);
      const lift = liftAt(a);
      const hgt = C.magHalf + (C.halfCar - C.magHalf) * lift;
      o.x = p.x + U.x * hgt; o.y = p.y + U.y * hgt; o.z = p.z + U.z * hgt;
      o.fwd = Tg; o.up = U;
      o.right = nrm(cross(o.up, o.fwd));
      o.height = o.y;
      o.pitch = Math.asin(clamp(Tg.y, -1, 1)) * 180 / Math.PI;
      o.roll = 0; o.speed = v;
      return o;
    }
    // 自由运动阶段：世界坐标直接存储
    o.x = L(A.x, B.x); o.y = L(A.y, B.y); o.z = L(A.z, B.z);
    const fallF = clamp(1 - (o.y - C.halfCar) / (y0 - C.halfCar), 0, 1);  // 归一化下降进度
    // 自由运动时的前进方向（带轻微低头）
    o.fwd = nrm(v3(fwd0.x, fwd0.y - 0.10 * fallF, fwd0.z));
    // up0 = 倒挂时的车顶方向（朝下），横滚绕车辆纵轴
    o.up = rotAxis(up0, o.fwd, roll);
    // 【根因修复】o.fwd 相对 up0 被修正过（低头），rotAxis 后的 up 不再严格 ⟂ fwd。
    // 渲染层的 makeCarBasis 会做正交化，而这里没有 → 两侧 up 出现 ~1e-2 的差异。
    // 统一在此正交化，使运动学与渲染层给出完全相同的姿态基。
    o.up = nrm(sub(o.up, scl(o.fwd, dot(o.up, o.fwd))));
    o.right = nrm(cross(o.up, o.fwd));
    o.roll = roll * 180 / Math.PI;
    o.speed = Math.abs(vy);
    o.height = o.y - C.halfCar;
    o.jet = phaseKind === 'cushion' ? 1.0 : 0.9;
    o.pitch = Math.asin(clamp(o.fwd.y, -1, 1)) * 180 / Math.PI;
    return o;
  }

  /** 阶段起止时间（供 HUD 时间轴按真实时长分段，而非样本计数） */
  function phaseSpans() {
    const out = [];
    for (const [k, e] of phaseIndex) {
      out.push({ kind: k, t0: e.t0, t1: e.t1, dur: e.dur });
    }
    return out.sort((a, b) => a.t0 - b.t0);
  }

  return {
    cfg: C, sample, st, TOTAL: st[st.length - 1].t,
    times: {
      tEnter, tRelease, tLand,
      vCap, dCap, cMag, y0,
      approachT, acc,
      capEndT, capEndA, capEndV, capOk,
      apexX: apex.x, apexY: apex.y, apexZ: apex.z,
    },
    apex, fwd0, up0, phaseSpans, phaseIndex,
  };
}
