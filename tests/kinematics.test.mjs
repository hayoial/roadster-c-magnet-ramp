// ============================================================
// tests/kinematics.test.mjs — 运动学单元测试
// 纯 node，无浏览器/three 依赖。运行: node tests/kinematics.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import {
  rampPoint, rampTangent, rampUp, rampSide, rampArcLength, rampParamSpeed,
  carCenterOnRamp, makeCarBasis, RAMP, CAR,
  v3, add, sub, scl, cross, dot, nrm, rotAxis, clamp,
} from '../outputs/ramp-geometry.js';
import { buildTimeline, deriveApproachDuration, CFG } from '../outputs/motion.js';

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function group(name) { console.log(`\n${name}`); }

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol,
  `${msg || ''} 期望 ${b} ± ${tol}，实得 ${a}`);
const vnear = (v, x, y, z, tol, msg) => {
  assert.ok(Math.abs(v.x - x) <= tol && Math.abs(v.y - y) <= tol && Math.abs(v.z - z) <= tol,
    `${msg || ''} 期望 (${x},${y},${z}) ± ${tol}，实得 (${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`);
};

const T = buildTimeline();
const tt = T.times;

// ============================================================
group('1. 坡道几何');

test('坡道起点在原点，切向 +X', () => {
  vnear(rampPoint(0), 0, 0, 0, 1e-12);
  vnear(rampTangent(0), 1, 0, 0, 1e-12);
});

test('坡道顶点 (0, 2R)，切向在 XY 平面朝 −X', () => {
  vnear(rampPoint(Math.PI), 0, 2 * RAMP.R, 0.5 * RAMP.k * Math.PI ** 2, 1e-9);
  const t = rampTangent(Math.PI);
  // 扭转使切向带 z 分量；XY 分量应朝 −X
  assert.ok(t.x < -0.9, `顶点切向 x 应朝负: ${t.x}`);
  near(t.y, 0, 1e-12, '顶点切向 y');
  assert.ok(t.z > 0, '顶点切向 z 应为正（扭转方向）');
  near(Math.hypot(t.x, t.y, t.z), 1, 1e-12, '顶点切向模');
});

test('坡道右腰 (R, R)，切向在 XY 平面朝 +Y', () => {
  vnear(rampPoint(Math.PI / 2), RAMP.R, RAMP.R, 0.5 * RAMP.k * (Math.PI / 2) ** 2, 1e-9);
  const t = rampTangent(Math.PI / 2);
  assert.ok(t.y > 0.9, `右腰切向 y 应朝正: ${t.y}`);
  near(t.x, 0, 1e-12, '右腰切向 x');
  assert.ok(t.z > 0, '右腰切向 z 应为正（扭转方向）');
});

test('rampUp 指向环心，a=π 时朝下（倒挂）', () => {
  vnear(rampUp(0), 0, 1, 0, 1e-12, 'a=0');
  vnear(rampUp(Math.PI), 0, -1, 0, 1e-12, 'a=π');
  near(rampUp(Math.PI / 2).x, -1, 1e-12, 'a=π/2 x 分量');
});

test('rampUp / rampTangent / rampSide 三者两两正交且归一', () => {
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * i / 20;
    const u = rampUp(a), t = rampTangent(a), s = rampSide(a);
    near(dot(u, t), 0, 1e-12, `a=${a} u·t`);
    near(dot(u, s), 0, 1e-12, `a=${a} u·s`);
    near(dot(t, s), 0, 1e-12, `a=${a} t·s`);
    near(Math.hypot(u.x, u.y, u.z), 1, 1e-12, `a=${a} |u|`);
    near(Math.hypot(t.x, t.y, t.z), 1, 1e-12, `a=${a} |t|`);
    near(Math.hypot(s.x, s.y, s.z), 1, 1e-12, `a=${a} |s|`);
  }
});

test('坡道弧长单调递增，总长 > 半圆周长', () => {
  let prev = 0;
  for (let i = 1; i <= 30; i++) {
    const s = rampArcLength(0, Math.PI * i / 30);
    assert.ok(s > prev, '弧长应单调递增');
    prev = s;
  }
  assert.ok(prev > Math.PI * RAMP.R, '含扭转的弧长应大于半圆周长');
});

test('坡道参数化速度与数值导数一致', () => {
  const h = 1e-6;
  for (const a of [0.3, 1.1, 2.0, 2.9]) {
    const p0 = rampPoint(a - h), p1 = rampPoint(a + h);
    const num = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) / (2 * h);
    near(rampParamSpeed(a), num, Math.abs(num) * 1e-5 + 1e-6, `a=${a}`);
  }
});

// ============================================================
group('2. 车辆姿态基（坐标系约定）');

test('makeCarBasis 产生纯旋转（det = +1）', () => {
  const det3 = (x, y, z) => dot(x, cross(y, z));
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * i / 24;
    const b = makeCarBasis(rampTangent(a), rampUp(a));
    near(det3(b.xAxis, b.up, b.right), 1, 1e-9, `a=${a}`);
  }
});

test('三基向量归一且两两正交', () => {
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * i / 24;
    const b = makeCarBasis(rampTangent(a), rampUp(a));
    near(dot(b.fwd, b.up), 0, 1e-9, `a=${a} f·u`);
    near(dot(b.fwd, b.right), 0, 1e-9, `a=${a} f·r`);
    near(dot(b.up, b.right), 0, 1e-9, `a=${a} u·r`);
    near(Math.hypot(b.fwd.x, b.fwd.y, b.fwd.z), 1, 1e-9);
    near(Math.hypot(b.up.x, b.up.y, b.up.z), 1, 1e-9);
    near(Math.hypot(b.right.x, b.right.y, b.right.z), 1, 1e-9);
  }
});

test('模型车头（局部 −X）始终指向前进方向', () => {
  // 模型局部 +X = 车长轴（车尾方向），车头在 −X
  for (const a of [0, 0.6, 1.4, Math.PI / 2, 2.3, Math.PI]) {
    const f = rampTangent(a);
    const b = makeCarBasis(f, rampUp(a));
    const head = scl(b.xAxis, -1);
    near(dot(head, b.fwd), 1, 1e-9, `a=${a} 车头·前进`);
  }
});

test('车顶方向不被翻转（up 与输入一致）', () => {
  for (const a of [0, 0.6, 1.4, Math.PI / 2, 2.3, Math.PI]) {
    const u0 = rampUp(a);
    const b = makeCarBasis(rampTangent(a), u0);
    near(dot(b.up, u0), 1, 1e-9, `a=${a}`);
  }
});

test('侧躺 90° 时车顶朝侧向，倒挂 180° 时车顶朝下', () => {
  const b90 = makeCarBasis(rampTangent(Math.PI / 2), rampUp(Math.PI / 2));
  near(Math.abs(b90.up.y), 0, 1e-9, 'a=90° 车顶应无竖直分量');
  const b180 = makeCarBasis(rampTangent(Math.PI), rampUp(Math.PI));
  near(b180.up.y, -1, 1e-9, 'a=180° 车顶应朝下');
});

// ============================================================
group('3. 助跑阶段');

test('助跑时长由距离/速度唯一确定（无配置矛盾）', () => {
  const D = 0 - CFG.approachStart;
  const dur = deriveApproachDuration(CFG);
  const acc = (CFG.vEntry ** 2 - CFG.vStart ** 2) / (2 * D);
  // 复算：位移应恰为 approachStart 到 0 的距离
  const d = CFG.vStart * dur + 0.5 * acc * dur * dur;
  near(d, D, 1e-6, '助跑位移');
  // 时长与运动学实际使用的一致
  near(tt.approachT, dur, 1e-9, '运动学采用的助跑时长');
  // 末速度应达 vEntry
  const accel = (CFG.vEntry - CFG.vStart) / dur;
  near(CFG.vStart + accel * dur, CFG.vEntry, 1e-9, '末速度');
  // 加速度应在物理合理范围（0.2g ~ 1.5g）
  assert.ok(acc / 9.81 > 0.2 && acc / 9.81 < 1.5, `助跑加速度 ${(acc / 9.81).toFixed(2)}g 超出合理范围`);
});

test('助跑末端位置恰为坡道入口 x=0，速度为 vEntry', () => {
  // tEnter 是【坡道首样本】的时刻，助跑末样本在 tEnter - dt
  const s = T.sample(tt.tEnter - 1e-9);
  near(s.x, 0, 1e-6, '助跑末端 x');
  near(s.speed, CFG.vEntry, 1e-6, '助跑末端速度');
  assert.equal(s.phase, 'approach');
});

test('助跑阶段位置单调递增', () => {
  let prev = -Infinity;
  for (let t = 0; t < tt.tEnter; t += 0.05) {
    const s = T.sample(t);
    assert.ok(s.x >= prev - 1e-9, `t=${t} 位置应单调递增`);
    prev = s.x;
  }
});

test('助跑速度单调递增且不超过 vEntry', () => {
  let prev = -Infinity;
  for (let t = 0; t < tt.tEnter; t += 0.05) {
    const s = T.sample(t);
    assert.ok(s.speed >= prev - 1e-9, `t=${t} 速度应单调递增`);
    assert.ok(s.speed <= CFG.vEntry + 1e-6, `t=${t} 速度超上限`);
    prev = s.speed;
  }
});

// ============================================================
group('4. 阶段连续性');

test('approach → climb 位置与速度连续', () => {
  const a = T.sample(tt.tEnter - 1e-6), b = T.sample(tt.tEnter);
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(d < 0.02, `位置跳变 ${d.toFixed(5)}m`);
  near(a.speed, b.speed, 0.05, '速度跳变');
});

test('所有阶段边界位置连续（跳变 < 5mm）', () => {
  const spans = T.phaseSpans();
  for (let i = 0; i < spans.length - 1; i++) {
    const A = spans[i], B = spans[i + 1];
    const a = T.sample(A.t1), b = T.sample(B.t0);
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    assert.ok(d < 0.005, `${A.kind}→${B.kind} 跳变 ${d.toFixed(6)}m`);
  }
});

test('阶段时长与样本数一致（无隐藏截断）', () => {
  const spans = T.phaseSpans();
  const sum = spans.reduce((s, p) => s + p.dur, 0);
  assert.ok(Math.abs(sum - T.TOTAL) < 0.05, `阶段总时长 ${sum} vs TOTAL ${T.TOTAL}`);
  for (const p of spans) assert.ok(p.dur >= 0, `${p.kind} 时长为负`);
});

// ============================================================
group('5. 磁吸捕获');

test('捕获恰好停在 a = π（误差 < 1e-6 rad）', () => {
  near(tt.capEndA, Math.PI, 1e-6, '停车参数');
  near((tt.capEndA * 180 / Math.PI), 180, 1e-4, '停车角度');
  assert.ok(tt.capOk, '捕获应标记为成功');
});

test('捕获结束残余速度为 0', () => {
  near(tt.capEndV, 0, 1e-6, '残余速度');
});

test('捕获阶段速度单调递减', () => {
  let prev = Infinity;
  for (let t = tt.tEnter; t <= tt.capEndT; t += 0.02) {
    const s = T.sample(t);
    assert.ok(s.speed <= prev + 1e-6, `t=${t} 捕获速度应单调递减`);
    prev = s.speed;
  }
});

test('捕获段 gLoad 为负（磁吸负过载）', () => {
  const mid = T.sample((tt.capEndT + tt.tEnter) / 2);
  assert.ok(mid.gLoad < 0, `捕获中段 gLoad 应为负，实得 ${mid.gLoad}`);
});

test('捕获失败会显式抛错而非静默成功', () => {
  // 构造不可能完成的捕获：捕获距离极短 → 减速度触底 → 应仍能停下但需极长时间
  let threw = false;
  try {
    const bad = buildTimeline({ ...CFG, magStart: 0.98 });  // 几乎立刻捕获
    // 若未抛错，至少必须停在 a=π
    near(bad.times.capEndA, Math.PI, 1e-6, '极端参数下仍应停在顶点');
  } catch (e) {
    threw = true;
    assert.match(e.message, /磁吸捕获失败/, '错误信息应说明捕获失败');
  }
  assert.ok(threw || true, '不要求极端参数必定失败，但失败必须显式');
});

// ============================================================
group('6. 倒挂悬停');

test('悬停期间位置与姿态恒定', () => {
  const s0 = T.sample(tt.capEndT + 0.01);
  const s1 = T.sample(tt.tRelease - 0.01);
  near(s0.x, s1.x, 1e-9, 'x');
  near(s0.y, s1.y, 1e-9, 'y');
  near(s0.z, s1.z, 1e-9, 'z');
  near(s0.speed, 0, 1e-9, '速度');
  near(s0.roll, 0, 1e-9, 'roll');
});

test('悬停期间车完全倒置（车顶朝下）', () => {
  const s = T.sample((tt.capEndT + tt.tRelease) / 2);
  near(s.up.y, -1, 1e-6, '车顶 y 分量');
  near(s.height, tt.y0, 1e-6, '悬停高度');
});

test('悬停期间 mag 标志为真', () => {
  const s = T.sample((tt.capEndT + tt.tRelease) / 2);
  assert.ok(s.mag, '磁吸标志应为真');
});

// ============================================================
group('7. 脱轨与自由运动');

test('脱轨初始条件继承自悬停（位置连续、速度从 0 起）', () => {
  const a = T.sample(tt.tRelease - 1e-6), b = T.sample(tt.tRelease);
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(d < 0.01, `脱轨位置跳变 ${d.toFixed(6)}m`);
  near(b.speed, 0, 0.05, '脱轨初速应接近 0');
});

test('脱轨后高度单调递减', () => {
  let prev = Infinity;
  for (let t = tt.tRelease; t <= tt.tLand; t += 0.02) {
    const s = T.sample(t);
    assert.ok(s.height <= prev + 1e-6, `t=${t} 高度应单调递减`);
    prev = s.height;
  }
});

test('横滚角从 0 单调增至 180°', () => {
  let prev = -1;
  for (let t = tt.tRelease; t <= tt.tLand; t += 0.02) {
    const s = T.sample(t);
    assert.ok(s.roll >= prev - 1e-6, `t=${t} roll 应单调不减`);
    assert.ok(s.roll <= 180 + 1e-6, `t=${t} roll 不应超过 180`);
    prev = s.roll;
  }
  near(T.sample(tt.tLand).roll, 180, 0.5, '着陆时 roll');
});

test('横滚完成后车身回正（车顶朝上）', () => {
  const s = T.sample(tt.tLand);
  near(s.up.y, 1, 0.02, '着陆时车顶 y 分量');
});

test('气垫段过载 > 1.5g 且速度单调下降至 0', () => {
  let prev = Infinity, maxG = 0;
  for (let t = tt.tRelease; t <= tt.tLand; t += 0.01) {
    const s = T.sample(t);
    if (s.phase === 'cushion') {
      maxG = Math.max(maxG, s.gLoad);
      assert.ok(s.speed <= prev + 1e-6, `t=${t} 缓冲段速度应单调下降`);
      prev = s.speed;
    }
  }
  assert.ok(maxG > 1.5, `缓冲段峰值过载应 > 1.5g，实得 ${maxG.toFixed(2)}`);
});

// ============================================================
group('8. 着陆');

test('着陆后高度恒为 0，速度恒为 0', () => {
  for (let t = tt.tLand; t <= T.TOTAL; t += 0.05) {
    const s = T.sample(t);
    near(s.height, 0, 1e-9, `t=${t} 着陆高度`);
    near(s.speed, 0, 1e-9, `t=${t} 着陆速度`);
  }
});

test('着陆后不穿地（高度不为负）', () => {
  for (let t = 0; t <= T.TOTAL; t += 0.05) {
    const s = T.sample(t);
    assert.ok(s.height >= -1e-9, `t=${t} 高度为负 ${s.height}`);
  }
});

test('悬挂在整个时间轴内保持静止（无抖动）', () => {
  for (let t = tt.capEndT; t <= tt.tRelease; t += 0.01) {
    const s = T.sample(t);
    near(s.speed, 0, 1e-6, `t=${t} 悬停速度`);
  }
});

// ============================================================
group('9. sample() 边界与确定性');

test('sample 对负时间 / 超界 / NaN 安全', () => {
  const a = T.sample(-5), b = T.sample(T.TOTAL + 100);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  const c = T.sample(NaN);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), 'NaN 输入应返回有限值');
  const d = T.sample(Infinity);
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y), 'Infinity 输入应返回有限值');
});

test('sample(0) 与 sample(TOTAL) 有效', () => {
  assert.ok(T.sample(0).phase === 'approach');
  assert.ok(T.sample(T.TOTAL).phase === 'landed');
});

test('同一时刻重复采样结果完全一致（确定性）', () => {
  for (let t = 0; t <= T.TOTAL; t += 0.137) {
    const a = T.sample(t), b = T.sample(t);
    assert.equal(a.x, b.x, `t=${t} x 不一致`);
    assert.equal(a.y, b.y, `t=${t} y 不一致`);
    assert.equal(a.z, b.z, `t=${t} z 不一致`);
    assert.equal(a.roll, b.roll, `t=${t} roll 不一致`);
    assert.equal(a.phase, b.phase, `t=${t} phase 不一致`);
  }
});

test('整个时间轴无 NaN / Infinity', () => {
  for (let t = 0; t <= T.TOTAL; t += 0.01) {
    const s = T.sample(t);
    for (const k of ['x', 'y', 'z', 'speed', 'roll', 'height', 'gLoad', 'a']) {
      assert.ok(Number.isFinite(s[k]), `t=${t} ${k} 非有限值: ${s[k]}`);
    }
    for (const v of [s.fwd, s.up, s.right]) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `t=${t} 基向量非有限值`);
      near(Math.hypot(v.x, v.y, v.z), 1, 1e-6, `t=${t} 基向量未归一`);
    }
  }
});

test('全程无位置跳变（相邻采样点位移 < 1m）', () => {
  let prev = T.sample(0);
  for (let t = 0.01; t <= T.TOTAL; t += 0.01) {
    const s = T.sample(t);
    const d = Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
    assert.ok(d < 1.0, `t=${t} 相邻点位移 ${d.toFixed(4)}m 过大`);
    prev = s;
  }
});

// ============================================================
group('10. 阶段覆盖');

test('八个阶段全部出现', () => {
  const kinds = new Set(T.st.map(s => s.kind));
  for (const k of ['approach', 'climb', 'capture', 'hang', 'descent', 'roll', 'cushion', 'landed'])
    assert.ok(kinds.has(k), `缺阶段 ${k}`);
});

test('阶段顺序正确且不重叠', () => {
  const order = T.st.map(s => s.kind);
  const seq = [];
  for (const k of order) if (seq[seq.length - 1] !== k) seq.push(k);
  const expect = ['approach', 'climb', 'capture', 'hang', 'descent', 'roll', 'cushion', 'landed'];
  assert.deepEqual(seq, expect, `阶段序列: ${seq.join('→')}`);
});

test('phaseSpans 时间连续覆盖全轴', () => {
  const spans = T.phaseSpans();
  near(spans[0].t0, 0, 1e-9);
  near(spans[spans.length - 1].t1, T.TOTAL, 1e-9);
  for (let i = 0; i < spans.length - 1; i++)
    near(spans[i].t1, spans[i + 1].t0, 1e-9, `spans[${i}] 与 [${i+1}] 不连续`);
});

// ============================================================
console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass}  失败 ${fail}  共 ${pass + fail}`);
if (fail) {
  console.log('\n失败明细:');
  for (const f of failures) console.log(`  · ${f.name}\n    ${f.err}`);
  process.exit(1);
}
console.log('全部通过 ✓');
