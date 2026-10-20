// ============================================================
// tests/geometry.test.mjs — 轨道 / 车辆接触几何测试
//
// 核心断言：车辆磁吸接触面与轨道【车行面】之间的有符号间隙必须为 0。
// 背景：早前版本渲染层用 rampSurface(a, 0.55) 当车行面，
//       而运动学层的接触面落在 rampPoint → 恒有 0.55m 间隙。
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CAR, RAMP, rampPoint, rampSurface, rampUp, rampTangent, rampSide,
  carCenterOnRamp, carCenterMag, magContactPoint, contactGap,
} from '../outputs/ramp-geometry.js';
import { buildTimeline } from '../outputs/motion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'outputs', 'index.html'), 'utf8');

let pass = 0, fail = 0; const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const group = (n) => console.log(`\n${n}`);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol,
  `${msg || ''} 期望 ${b} ± ${tol}，实得 ${a}`);

// ============================================================
group('1. 几何量的语义一致性');

test('rampPoint 是车行面，rampSurface 是轨道背面（相差 RAMP_T）', () => {
  const T = 0.55;
  for (const d of [0, 45, 90, 135, 180]) {
    const a = d * Math.PI / 180;
    const p = rampPoint(a), s = rampSurface(a, T), u = rampUp(a);
    // 背面 = 车行面 − up·T
    near(s.x, p.x - u.x * T, 1e-12, `a=${d}° x`);
    near(s.y, p.y - u.y * T, 1e-12, `a=${d}° y`);
    near(s.z, p.z - u.z * T, 1e-12, `a=${d}° z`);
  }
});

test('渲染层不再用 rampSurface 作为车行面', () => {
  // 车行面网格必须用 rampPoint3
  assert.ok(html.includes('const rampPoint3 = (a)'), '应定义 rampPoint3');
  assert.ok(html.includes('const p = rampPoint3(a), u = rampUp3(a), tg = rampTan3(a);'),
    '车行面网格顶点应取自 rampPoint3');
  assert.ok(!html.includes('rampSurf3'), '不得再有 rampSurf3（旧的错误基准）');
  // RAMP_T 只用于构件挂载方向，不得用于车行面
  const tIdx = html.indexOf('const RAMP_T');
  assert.ok(tIdx > 0, '应定义 RAMP_T');
});

test('RAMP_T 在渲染层只用于背向构件（腹板/支撑柱）', () => {
  const uses = [...html.matchAll(/RAMP_T/g)].length;
  assert.ok(uses >= 3, `RAMP_T 应至少出现 3 次（定义+腹板+支撑柱），实得 ${uses}`);
  // 负向偏移（背离环心）才正确
  assert.ok(html.includes('addScaledVector(u, -RAMP_T)'), '腹板应沿 -up 方向伸到轨道背面');
});

test('CAR.magContact 与 CAR.rideHeight 是两个不同基准', () => {
  assert.ok(CAR.magContact > 0 && CAR.rideHeight > 0);
  assert.ok(Math.abs(CAR.rideHeight - CAR.magContact - 0.195) < 1e-12,
    `两者应相差 0.195m（轮胎离地高 − 磁吸贴合面），实得 ${CAR.rideHeight - CAR.magContact}`);
  // 轮胎几何自洽
  near(CAR.rideHeight, 0.28 + CAR.wheelRadius, 1e-12, 'rideHeight 应等于轮心高 + 轮半径');
});

// ============================================================
group('2. 接触几何（核心）');

test('磁吸状态：接触面与车行面零间隙（a=0/π/2·π/4/3π/4）', () => {
  for (const d of [0, 45, 90, 135, 180]) {
    const a = d * Math.PI / 180;
    const c = carCenterMag(a);
    const gap = contactGap(a, c);
    assert.ok(Math.abs(gap) < 1e-9, `a=${d}° 接触间隙 ${gap} 应为 0`);
  }
});

test('接触间隙接口能检出真实偏差（自检灵敏度）', () => {
  const a = Math.PI / 2;
  const c = carCenterMag(a);
  const g0 = contactGap(a, c);
  // 人为把车身推离轨道 0.1m → 间隙应变为 0.1
  const up = rampUp(a);
  const c2 = { x: c.x + up.x * 0.1, y: c.y + up.y * 0.1, z: c.z + up.z * 0.1 };
  near(contactGap(a, c2), 0.1, 1e-12, '推离 0.1m 后间隙');
  near(g0, 0, 1e-12, '原始间隙');
});

test('接触面恒等于 rampPoint（代数恒等）', () => {
  for (const d of [0, 37, 90, 143, 180]) {
    const a = d * Math.PI / 180;
    const c = carCenterMag(a);
    const up = rampUp(a);
    const contact = { x: c.x - up.x * CAR.magContact, y: c.y - up.y * CAR.magContact, z: c.z - up.z * CAR.magContact };
    const p = rampPoint(a);
    near(Math.hypot(contact.x - p.x, contact.y - p.y, contact.z - p.z), 0, 1e-12, `a=${d}°`);
  }
});

test('magContactPoint 与 rampPoint 一致', () => {
  for (const d of [0, 90, 180]) {
    const a = d * Math.PI / 180;
    const m = magContactPoint(a), p = rampPoint(a);
    near(Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z), 0, 1e-12, `a=${d}°`);
  }
});

// ============================================================
group('3. 时间轴中的接触状态');

const T = buildTimeline();
const tt = T.times;

test('入坡过渡：lift 从 1 连续衰减到 0，接触间隙随之归零', () => {
  // a=0 处车身由轮胎支撑（离地 rideHeight），随磁吸吸起过渡到 magContact
  const s0 = T.sample(tt.tEnter);
  assert.equal(s0.phase, 'climb');
  const g0 = contactGap(s0.a, s0);
  // 间隙定义：正 = 接触面在车行面之外（悬空未贴合），负 = 陷入轨道（穿模）
  // a=0 时车身中心 y=rideHeight=0.58，磁吸面 = 0.58−0.385 = 0.195 > 路面 y=0
  // → 间隙 +0.195m，正是磁吸把车从地面"吸起"的过程
  near(g0, CAR.rideHeight - CAR.magContact, 1e-9, '入坡瞬间接触间隙');

  // 间隙应单调收敛到 0（不得有穿模）
  let prev = g0;
  for (let t = tt.tEnter; t <= tt.tEnter + 0.6; t += 0.02) {
    const s = T.sample(t);
    const g = contactGap(s.a, s);
    assert.ok(g <= prev + 1e-6, `t=${t.toFixed(2)} 间隙应单调不增: ${prev} → ${g}`);
    assert.ok(g >= -1e-9, `t=${t.toFixed(2)} 接触面陷入轨道: ${g}`);
    prev = g;
  }

  // 过渡结束后接触间隙应为 0
  const s1 = T.sample(tt.tEnter + 1.0);
  assert.ok(s1.a > 0.55, `1s 后应已完成过渡，a=${s1.a}`);
  near(contactGap(s1.a, s1), 0, 1e-9, '过渡完成后接触间隙');
});

test('整个爬坡+捕获+悬停阶段接触间隙单调收敛到 0', () => {
  const samples = [];
  for (let t = tt.tEnter; t <= tt.capEndT; t += 0.05) {
    const s = T.sample(t);
    samples.push({ t, a: s.a, gap: contactGap(s.a, s) });
  }
  // 最后一个样本（悬停中）间隙为 0
  near(samples[samples.length - 1].gap, 0, 1e-9, '悬停时接触间隙');
  // 悬停段全程为 0
  const hangStart = samples.findIndex(s => s.a > 0.55);
  for (const s of samples.slice(hangStart)) {
    near(s.gap, 0, 1e-6, `t=${s.t.toFixed(2)} 接触间隙`);
  }
});

test('倒挂捕获：车顶朝下且接触面贴住轨道', () => {
  const s = T.sample((tt.capEndT + tt.tRelease) / 2);
  assert.equal(s.phase, 'hang');
  near(s.up.y, -1, 1e-9, '悬停时车顶应朝下');
  near(contactGap(s.a, s), 0, 1e-9, '悬停时接触间隙');
  // 接触面应在车身【上方】(车底朝上)
  const up = rampUp(s.a);
  assert.ok(s.up.y < 0, '倒挂时 up 朝下');
});

test('悬停期间接触间隙恒为 0（逐点）', () => {
  for (let t = tt.capEndT; t <= tt.tRelease; t += 0.01) {
    const s = T.sample(t);
    near(contactGap(s.a, s), 0, 1e-9, `t=${t.toFixed(3)}`);
  }
});

test('脱轨瞬间车保持磁吸姿态与接触位置（不跳变）', () => {
  const a = T.sample(tt.tRelease - 1e-4), b = T.sample(tt.tRelease);
  near(a.x, b.x, 1e-3, 'x');
  near(a.y, b.y, 1e-3, 'y');
  near(a.z, b.z, 1e-3, 'z');
  near(a.up.y, b.up.y, 1e-6, 'up');
});

// ============================================================
group('4. 地面/着陆基准');

test('地面阶段车身中心高度 = rideHeight（轮胎接地）', () => {
  const s = T.sample(0.2);
  assert.equal(s.phase, 'approach');
  near(s.y, CAR.rideHeight, 1e-9, '助跑时车身中心高度');
  near(s.height, 0, 1e-9, '离地高度');
});

test('着陆后车身中心高度 = rideHeight 且轮胎接地', () => {
  const s = T.sample(tt.tLand + 0.5);
  near(s.y, CAR.rideHeight, 1e-9, '着陆后车身中心高度');
  near(s.height, 0, 1e-9, '离地高度');
});

test('入坡前车身在地面上（不悬空）', () => {
  const s = T.sample(tt.tEnter - 0.01);
  near(s.height, 0, 1e-3, '入坡前离地高度');
});

// ============================================================
group('5. 轨道实体几何');

test('轨道背面在车行面的背离环心侧', () => {
  for (const d of [0, 90, 180]) {
    const a = d * Math.PI / 180;
    const p = rampPoint(a), b = rampSurface(a, 0.55), u = rampUp(a);
    // 背面相对车行面沿 -up 方向 → 背离环心
    const dir = { x: b.x - p.x, y: b.y - p.y, z: b.z - p.z };
    const alongUp = dir.x * u.x + dir.y * u.y + dir.z * u.z;
    assert.ok(alongUp < 0, `a=${d}° 背面应沿 -up 方向（背离环心），实得 ${alongUp}`);
  }
});

test('坡道不与地面穿插（入口处车行面在 y=0）', () => {
  const p = rampPoint(0);
  near(p.y, 0, 1e-12, '入口车行面高度');
  const b = rampSurface(0, 0.55);
  // 入口处轨道实体向 -up 延伸 → 沉入地下（埋入式基础），符合工程直觉
  assert.ok(b.y < 0, '入口处轨道背面应埋入地下');
});

test('顶点处车行面高于地面（结构合理）', () => {
  const p = rampPoint(Math.PI);
  assert.ok(p.y > 2 * RAMP.R - 1e-9, `顶点车行面 y=${p.y} 应等于 2R`);
  near(p.y, 2 * RAMP.R, 1e-9, '顶点高度');
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
