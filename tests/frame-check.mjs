// 逐帧几何验证：穿轨 / 悬空 / 瞬移 / 姿态镜像
import { buildTimeline, CFG } from '../outputs/motion.js';
import { rampPoint, rampUp, rampTangent, CAR, makeCarBasis, cross, dot, nrm, sub, scl } from '../outputs/ramp-geometry.js';

const T = buildTimeline();
const dt = 1 / 240;
let issues = [];

// --- 1. 穿轨检测：磁吸阶段接触面不得陷入轨道 ---
let maxPen = 0, penAt = 0;
for (let t = 0; t <= T.TOTAL; t += dt) {
  const s = T.sample(t);
  if (s.phase === 'climb' || s.phase === 'capture' || s.phase === 'hang') {
    const p = rampPoint(s.a), u = rampUp(s.a);
    const contact = { x: s.x - u.x * CAR.magContact, y: s.y - u.y * CAR.magContact, z: s.z - u.z * CAR.magContact };
    const gap = (contact.x - p.x) * u.x + (contact.y - p.y) * u.y + (contact.z - p.z) * u.z;
    if (gap < maxPen) { maxPen = gap; penAt = t; }
  }
}
console.log('1. 穿轨检测: 最大侵入深度 = ' + maxPen.toFixed(9) + ' m @ t=' + penAt.toFixed(2) +
            (maxPen < -1e-6 ? '  ✗ 穿轨' : '  ✓ 无穿轨'));

// --- 2. 悬空检测：接触面与轨道面间隙在磁吸完成后应为 0 ---
let maxGapAfter = 0;
for (let t = 0; t <= T.TOTAL; t += dt) {
  const s = T.sample(t);
  if (s.phase === 'capture' || s.phase === 'hang') {
    const p = rampPoint(s.a), u = rampUp(s.a);
    const contact = { x: s.x - u.x * CAR.magContact, y: s.y - u.y * CAR.magContact, z: s.z - u.z * CAR.magContact };
    const gap = (contact.x - p.x) * u.x + (contact.y - p.y) * u.y + (contact.z - p.z) * u.z;
    maxGapAfter = Math.max(maxGapAfter, Math.abs(gap));
  }
}
console.log('2. 悬空检测: 磁吸后最大间隙 = ' + maxGapAfter.toFixed(9) + ' m' +
            (maxGapAfter < 1e-6 ? '  ✓ 贴合' : '  ✗ 悬空'));

// --- 3. 瞬移检测：相邻帧位移有界 ---
let maxJump = 0, jumpAt = 0, maxJerk = 0;
let prev = T.sample(0);
for (let t = dt; t <= T.TOTAL; t += dt) {
  const s = T.sample(t);
  const d = Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
  if (d > maxJump) { maxJump = d; jumpAt = t; }
  // 加速度有界
  const a2 = Math.hypot(s.x - 2 * prev.x + 0, s.y - 2 * prev.y, s.z - 2 * prev.z) / (dt * dt);
  prev = s;
}
console.log('3. 瞬移检测: 相邻帧最大位移 = ' + maxJump.toFixed(6) + ' m @ t=' + jumpAt.toFixed(2) +
            ' (60fps 下应 < 0.5m)' + (maxJump < 0.5 ? '  ✓' : '  ✗'));

// --- 4. 姿态镜像检测：det 必须恒为 +1 ---
let minDet = 9, maxDet = -9, mirrorAt = 0;
for (let t = 0; t <= T.TOTAL; t += dt) {
  const s = T.sample(t);
  const b = makeCarBasis(s.fwd, s.up);
  const det = dot(b.xAxis, cross(b.up, b.right));
  if (det < minDet) { minDet = det; mirrorAt = t; }
  maxDet = Math.max(maxDet, det);
}
console.log('4. 镜像检测: det ∈ [' + minDet.toFixed(9) + ', ' + maxDet.toFixed(9) + ']' +
            (minDet > 0.999999 ? '  ✓ 纯旋转，无镜像' : '  ✗ 存在镜像 @ t=' + mirrorAt.toFixed(2)));

// --- 5. 车头方向检测：模型车头应始终沿前进方向（半角 < 90°）---
let minDot = 9, mdAt = 0;
for (let t = 0; t <= T.TOTAL; t += dt) {
  const s = T.sample(t);
  const b = makeCarBasis(s.fwd, s.up);
  const head = { x: -b.xAxis.x, y: -b.xAxis.y, z: -b.xAxis.z };
  const d = dot(head, s.fwd);
  if (d < minDot) { minDot = d; mdAt = t; }
}
console.log('5. 朝向检测: min(车头·前进) = ' + minDot.toFixed(9) + ' @ t=' + mdAt.toFixed(2) +
            (minDot > 0.999999 ? '  ✓ 车头始终朝前' : '  ✗ 车头偏离'));

// --- 6. 地面穿透检测：全程高度 >= 0 ---
let minH = 9, hAt = 0;
for (let t = 0; t <= T.TOTAL; t += dt) {
  const s = T.sample(t);
  if (s.height < minH) { minH = s.height; hAt = t; }
}
console.log('6. 地面检测: 最小高度 = ' + minH.toFixed(9) + ' m @ t=' + hAt.toFixed(2) +
            (minH > -1e-9 ? '  ✓ 不穿地' : '  ✗ 穿地'));

// --- 7. 速度连续性：阶段边界附近速度无突变 ---
let maxVelJump = 0, vjAt = 0;
for (const sp of T.phaseSpans().slice(0, -1)) {
  const a = T.sample(sp.t1 - 0.002), b = T.sample(sp.t1 + 0.002);
  const d = Math.abs(a.speed - b.speed);
  if (d > maxVelJump) { maxVelJump = d; vjAt = sp.t1; }
}
console.log('7. 速度连续: 边界最大速度跳变 = ' + maxVelJump.toFixed(9) + ' m/s @ t=' + vjAt.toFixed(2) +
            (maxVelJump < 0.05 ? '  ✓' : '  ✗'));

// 任一检测不通过 → 退出码 1
const failures = [];
if (maxPen < -1e-6) failures.push('穿轨');
if (maxGapAfter >= 1e-6) failures.push('悬空');
if (maxJump >= 0.5) failures.push('瞬移');
if (minDet <= 0.999999) failures.push('姿态镜像');
if (minDot <= 0.999999) failures.push('朝向错误');
if (minH <= -1e-9) failures.push('穿地');
if (maxVelJump >= 0.05) failures.push('速度突变');
if (failures.length) {
  console.error('\n✗ 逐帧检测失败: ' + failures.join(', '));
  process.exit(1);
}
console.log('\n逐帧检测全部通过 ✓');
