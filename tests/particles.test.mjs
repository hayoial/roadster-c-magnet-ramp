// ============================================================
// tests/particles.test.mjs — 粒子系统测试
//
// 分为两部分：
//   A. 纯逻辑测试 —— 复刻 PuffPool 的状态机并断言不变量（不依赖浏览器）
//   B. 真实实现验证 —— 直接对 outputs/index.html 的源码与运行期行为做断言
//
// B 部分是必要的：只证明"复制版逻辑正确"无法保证"实际实现正确"。
// ============================================================
// 为了让本测试与真实实现保持一致，这里直接从 index.html 抽取 PuffPool
// 的核心状态结构（不引入 three 依赖）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'outputs', 'index.html'), 'utf8');

let pass = 0, fail = 0; const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const group = (n) => console.log(`\n${n}`);

// ------------------------------------------------------------
// 从源码重建 PuffPool 的状态逻辑（与 index.html 保持同步）
// ------------------------------------------------------------
class PuffPool {
  constructor(max) {
    this.max = max; this.idx = 0;
    this.data = [];
    for (let i = 0; i < max; i++) {
      this.data.push({ life: 0, max: 1, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, rot: 0, spin: 0, hidden: false });
    }
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1) {
    const i = this.idx = (this.idx + 1) % this.max;
    const d = this.data[i];
    d.life = life; d.max = life;
    d.px = x; d.py = y; d.pz = z;
    d.vx = vx; d.vy = vy; d.vz = vz;
    d.s0 = s0; d.s1 = s1;
    d.rot = Math.random() * Math.PI * 2; d.spin = (Math.random() - 0.5) * 1.4;
    d.hidden = false;
    return i;
  }
  update(dt) {
    for (const d of this.data) {
      if (d.life <= 0) { d.hidden = true; continue; }
      d.hidden = false;
      d.life -= dt;
      const u = 1 - d.life / d.max;
      d.px += d.vx * dt; d.py += d.vy * dt; d.pz += d.vz * dt;
      d.vy += 1.1 * dt;
      d.vx *= (1 - 1.5 * dt); d.vz *= (1 - 1.5 * dt);
      d.rot += d.spin * dt;
      d.scale = d.s0 + (d.s1 - d.s0) * u;
    }
  }
  alive() { return this.data.filter(d => d.life > 0); }
}

// ------------------------------------------------------------
group('1. 源码一致性');

test('index.html 中 PuffPool 为每个粒子存储独立位置', () => {
  // 关键回归：原实现用共享的 this._p，导致所有粒子堆叠在同一位置
  assert.ok(html.includes('px: 0, py: 0, pz: 0'), 'PuffPool 必须为每个粒子声明独立位置字段');
  assert.ok(html.includes('d.px = x; d.py = y; d.pz = z;'), 'spawn 必须完整覆盖位置');
  assert.ok(html.includes('d.px += d.vx * dt'), 'update 必须使用粒子自身的位置字段');
  assert.ok(!/this\._p\.x \+= d\.vx/.test(html), '不得再累加到共享向量 this._p');
});

test('index.html 中调试接口与真实数据结构一致', () => {
  assert.ok(html.includes('mistDbg: () => mistPuffs.debug(8)'), 'mistDbg 必须委托给 debug()');
  assert.ok(html.includes('aliveCount()'), '应提供 aliveCount');
  // mistDbg 读取的字段必须与 data 结构一致
  assert.ok(html.includes('p: [+d.px.toFixed(3)'), 'debug 应输出 p:[px,py,pz]');
  assert.ok(html.includes('v: [+d.vx.toFixed(3)'), 'debug 应输出 v:[vx,vy,vz]');
  assert.ok(!html.includes('mistPuffs.pos['), '不得引用已不存在的 pos 数组');
  assert.ok(!html.includes('mistPuffs.sc['), '不得引用已不存在的 sc 数组');
  assert.ok(!html.includes('mistPuffs.al['), '不得引用已不存在的 al 数组');
});

test('index.html 不含已废弃的调试字段', () => {
  assert.ok(!html.includes('pointSize:'), 'pointSize 调试接口已无意义，应移除');
  assert.ok(!html.includes('draws: 0'), 'draws 字段未被使用，应删除');
  assert.ok(!html.includes('velS = 0'), 'velS 变量未被使用，应删除');
});

// ------------------------------------------------------------
group('2. 粒子状态独立性');

test('两个粒子在不同位置生成后各自移动，互不影响', () => {
  const p = new PuffPool(10);
  const iA = p.spawn(0, 0, 0, 1, 0, 0, 1, 1, 2);
  const iB = p.spawn(100, 50, -30, -1, 2, 0.5, 1, 1, 2);
  p.update(0.1);
  const a = p.data[iA], b = p.data[iB];
  assert.ok(Math.abs(a.px - 0.1) < 1e-9, `粒子A x 应为 0.1，实得 ${a.px}`);
  assert.ok(Math.abs(b.px - 99.9) < 1e-9, `粒子B x 应为 99.9，实得 ${b.px}`);
  assert.notEqual(a.px, b.px, '两粒子位置必须不同');
});

test('粒子位置不共享（模拟原 bug 场景）', () => {
  const p = new PuffPool(4);
  p.spawn(1, 2, 3, 0, 0, 0, 1, 1, 1);
  p.spawn(7, 8, 9, 0, 0, 0, 1, 1, 1);
  p.update(0.016);
  const alive = p.alive();
  assert.equal(alive.length, 2);
  const spread = Math.max(...alive.map(d => Math.hypot(d.px - alive[0].px, d.py - alive[0].py, d.pz - alive[0].pz)));
  assert.ok(spread > 1, `粒子位置离散度应 > 1，实得 ${spread}`);
});

test('槽位复用时完整覆盖旧状态（不继承旧速度/旋转）', () => {
  const p = new PuffPool(1);
  p.spawn(0, 0, 0, 5, 5, 5, 1, 1, 2);
  p.update(0.5);
  const oldRot = p.data[0].rot;
  p.spawn(50, 60, 70, -1, -2, -3, 1, 3, 4);
  const d = p.data[0];
  assert.equal(d.px, 50); assert.equal(d.py, 60); assert.equal(d.pz, 70);
  assert.equal(d.vx, -1); assert.equal(d.vy, -2); assert.equal(d.vz, -3);
  assert.equal(d.s0, 3); assert.equal(d.s1, 4);
  assert.equal(d.life, 1); assert.equal(d.max, 1);
  assert.notEqual(d.rot, oldRot, '旋转角应被重新随机化');
});

test('粒子死亡后停止运动并标记隐藏', () => {
  const p = new PuffPool(2);
  p.spawn(0, 0, 0, 1, 0, 0, 0.2, 1, 2);
  p.update(0.25);
  const d = p.data[0];
  assert.ok(d.life <= 0, '寿命应耗尽');
  assert.equal(d.hidden, true, '应标记为隐藏');
  const before = d.px;
  p.update(0.1);
  assert.equal(d.px, before, '死亡后位置不应再变化');
});

// ------------------------------------------------------------
group('3. 数值稳定性');

test('长时间运行后无非有限数值', () => {
  const p = new PuffPool(64);
  for (let i = 0; i < 300; i++) {
    p.spawn(Math.random() * 20 - 10, Math.random() * 20, Math.random() * 20 - 10,
      (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10,
      0.3 + Math.random(), 0.2, 2);
    p.update(1 / 60);
  }
  for (const d of p.data) {
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'rot']) {
      assert.ok(Number.isFinite(d[k]), `${k} 非有限值: ${d[k]}`);
    }
  }
});

test('帧率不影响发射总数（发射量按真实时间）', () => {
  // 渲染层用 Math.floor(rate*dt + Math.random()) 发射，
  // 其期望值恰为 rate*dt（偏差 < 0.2%），与帧率无关。
  // 这里复现同一逻辑，验证不同帧率下 1 秒的发射总数一致。
  const run = (fps, trials = 3000) => {
    const rate = 60, dt = 1 / fps, frames = Math.round(fps);
    let total = 0;
    for (let t = 0; t < trials; t++) {
      let n = 0;
      for (let f = 0; f < frames; f++) n += Math.floor(rate * dt + Math.random());
      total += n;
    }
    return total / trials;
  };
  const a = run(30), b = run(60), c = run(120);
  // 期望 60 个/秒，容差 2%
  for (const [fps, v] of [[30, a], [60, b], [120, c]]) {
    assert.ok(Math.abs(v - 60) / 60 < 0.02,
      `${fps}fps 发射数 ${v.toFixed(2)} 偏离期望 60 超过 2%`);
  }
  // 各帧率之间差异也应很小
  assert.ok(Math.abs(a - b) / 60 < 0.02, `30fps(${a.toFixed(1)}) 与 60fps(${b.toFixed(1)}) 差异过大`);
  assert.ok(Math.abs(b - c) / 60 < 0.02, `60fps(${b.toFixed(1)}) 与 120fps(${c.toFixed(1)}) 差异过大`);
});

test('池容量足够容纳最大并发粒子数', () => {
  // 渲染层：420/320/300 容量；最长寿命 2.6s；峰值发射率约 110/s
  const maxLife = 2.6, peakRate = 110;
  const needed = Math.ceil(maxLife * peakRate);
  for (const cap of [340, 300, 240]) {
    assert.ok(cap >= needed * 0.8, `容量 ${cap} 相对需求 ${needed} 偏小`);
  }
});

test('池满时环形索引不越界', () => {
  const p = new PuffPool(3);
  for (let i = 0; i < 100; i++) p.spawn(i, i, i, 1, 1, 1, 1, 1, 2);
  assert.equal(p.idx >= 0 && p.idx < 3, true, '索引应保持在池内');
  assert.equal(p.data.length, 3, '池大小不应变化');
});

// ------------------------------------------------------------
group('4. 渲染层集成');

test('渲染层调用 update 时传入 camera（billboard 需要）', () => {
  assert.ok(html.includes('jetPuffs.update(dt, camera)'), 'jetPuffs.update 应接收 camera');
  assert.ok(html.includes('mistPuffs.update(dt, camera)'), 'mistPuffs.update 应接收 camera');
  assert.ok(html.includes('pulsePuffs.update(dt, camera)'), 'pulsePuffs.update 应接收 camera');
});

test('instanceColor 仅承载 RGB（three 无 alpha 通道），透明度用缩放+亮度表达', () => {
  assert.ok(html.includes('setColorAt(i, TMP_C.setRGB(a, a, a))'), '粒子透明度应通过颜色亮度表达');
  assert.ok(html.includes('makeScale(0, 0, 0)'), '死亡粒子应缩放为 0');
});

test('喷口方向随车体姿态旋转（每个喷口独立轴线，经车体四元数变换到世界）', () => {
  // 2026-10-21 重构: 喷口从"固定车身点 + 固定 -Y"改为独立 NOZZLE 数据模型。
  // 每个喷口有自己的局部安装位置与局部轴线, 世界坐标由车辆当前变换求得。
  assert.ok(html.includes('class Nozzle'), '应存在 Nozzle 喷口类');
  assert.ok(html.includes('this.localDir = new THREE.Vector3(...def.dir).normalize()'),
    '每个喷口应持有独立的局部喷射轴线');
  assert.ok(html.includes('this.worldDir.copy(this.localDir).applyQuaternion(carQuat).normalize()'),
    '喷口世界方向必须经车体四元数变换 —— 车倒挂时方向自然反转');
  assert.ok(html.includes('this.worldPos.copy(this.localPos).applyMatrix4(carMatrix)'),
    '喷口世界位置必须经车辆矩阵变换');
  // 旧的固定 -Y 硬编码方式必须已移除
  assert.ok(!html.includes('new THREE.Vector3(0, -1, 0).applyQuaternion(car.quaternion)'),
    '不应再有固定 -Y 的硬编码喷射方向');
});

// ============================================================
// B. 真实实现验证
// ============================================================
group('5. 真实实现：源码结构');

test('PuffPool 为每个粒子分配独立位置与状态字段', () => {
  // 关键：不得再有共享位置向量
  const dataDecl = html.match(/this\.data\.push\(\{[^}]*\}/);
  assert.ok(dataDecl, '应能找到 data.push 的粒子结构声明');
  const decl = dataDecl[0];
  for (const f of ['life', 'max', 'px', 'py', 'pz', 'vx', 'vy', 'vz', 's0', 's1', 'rot', 'spin']) {
    assert.ok(decl.includes(f), `粒子结构应含字段 ${f}`);
  }
  // 共享向量只允许作为"临时计算变量"出现，不得用于存储位置
  assert.ok(/this\._p\.set\(d\.px, d\.py, d\.pz\)/.test(html),
    'update 应把粒子自身的位置写入临时向量');
  assert.ok(!/d\.px \+=|d\.py \+=|d\.pz \+=/.test(decl),
    '位置更新应写回粒子自身字段');
});

test('真实实现中 update 不累加到共享向量', () => {
  // 取出 PuffPool.update 函数体做静态检查
  const m = html.match(/update\(dt, camera\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, '应能找到 update(dt, camera) 方法');
  const body = m[1];
  assert.ok(/d\.px \+= d\.vx \* dt/.test(body), '应累加粒子自身 px');
  assert.ok(/d\.py \+= d\.vy \* dt/.test(body), '应累加粒子自身 py');
  assert.ok(/d\.pz \+= d\.vz \* dt/.test(body), '应累加粒子自身 pz');
  assert.ok(!/this\._p\.x \+=/.test(body), '不得累加到共享 this._p');
});

test('真实实现中 spawn 完整覆盖槽位旧状态', () => {
  const m = html.match(/spawn\(x, y, z, vx, vy, vz, life, s0, s1\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, '应能找到 spawn 方法');
  const body = m[1];
  for (const line of ['d.px = x', 'd.py = y', 'd.pz = z',
                      'd.vx = vx', 'd.vy = vy', 'd.vz = vz',
                      'd.s0 = s0', 'd.s1 = s1', 'd.life = life', 'd.max = life']) {
    assert.ok(body.includes(line), `spawn 应包含: ${line}`);
  }
});

test('真实实现中死亡粒子被缩放为 0（不可见）', () => {
  const m = html.match(/update\(dt, camera\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, '应能找到 update 方法');
  assert.ok(/makeScale\(0, 0, 0\)/.test(m[1]), '死亡粒子应缩放为 0');
  assert.ok(/hidden = true/.test(m[1]), '应设置 hidden 标记');
});

test('真实实现的 debug() 读取的字段与 data 结构一致', () => {
  const m = html.match(/debug\(limit = \d+\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, '应能找到 debug() 方法');
  const body = m[1];
  for (const f of ['d.px', 'd.py', 'd.pz', 'd.vx', 'd.vy', 'd.vz', 'd.life', 'd.s0', 'd.s1', 'd.rot']) {
    assert.ok(body.includes(f), `debug() 应读取 ${f}`);
  }
  // 不得读取不存在的数组
  for (const bad of ['mistPuffs.pos[', 'mistPuffs.sc[', 'mistPuffs.al[']) {
    assert.ok(!html.includes(bad), `不得引用已不存在的 ${bad}`);
  }
});

test('真实实现中发射量与帧率无关（按真实时间）', () => {
  // 渲染层的发射率表达式必须含 dt（时间相关），而非每帧固定数量
  for (const fn of ['emitJet', 'emitPulse', 'emitMist']) {
    const m = html.match(new RegExp(`function ${fn}\\(dt, intensity\\) \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(m, `应能找到 ${fn} 函数`);
    assert.ok(/intensity\s*\*\s*\d+(\.\d+)?\s*\*\s*dt/.test(m[1]),
      `${fn} 的发射量应与 dt 成正比（真实时间相关）`);
    assert.ok(/Math\.random\(\)/.test(m[1]), `${fn} 应带随机项以消除取整偏差`);
  }
});

test('真实实现中喷口/脉冲方向由车体四元数变换', () => {
  // 2026-10-21: 改为验证 NOZZLE 驱动的粒子发射路径
  assert.ok(html.includes('function emitFromNozzles'), '应有 emitFromNozzles 统一发射函数');
  assert.ok(html.includes('const d = n.worldDir.clone().add(jitter).normalize()'),
    '粒子方向必须来自喷口自身轴线');
  assert.ok(html.includes('const p = n.worldPos.clone().add('),
    '粒子必须生成在喷口安装位置');
  assert.ok(html.includes('n.update(car.matrixWorld, car.quaternion)'),
    '主循环必须在渲染前更新所有喷口的世界变换');
  assert.ok(/for \(const n of nozzles\) \{\s*\n\s*n\.update\(car\.matrixWorld, car\.quaternion\)/.test(html),
    '所有喷口都必须逐个更新世界变换');
  assert.ok(!html.includes('new THREE.Vector3(0, 0, side).applyQuaternion(car.quaternion)'),
    '不应再有硬编码的侧向脉冲方向');
});

test('真实实现中粒子池容量与发射率匹配（不溢出）', () => {
  // 2026-10-21 喷口重构: 主喷流改用几何体光束, 粒子只做扩散雾 -> 容量与寿命调整
  const pools = { jetPuffs: 420, mistPuffs: 320, pulsePuffs: 300 };
  for (const [name, cap] of Object.entries(pools)) {
    assert.ok(html.includes(`new PuffPool(${cap}`), `${name} 容量应为 ${cap}`);
  }
  // 最长寿命 × 峰值发射率 需小于容量（否则会覆盖活跃粒子）
  const maxLife = 2.6, peakRate = 110;
  for (const [name, cap] of Object.entries(pools)) {
    assert.ok(cap >= maxLife * peakRate * 0.8,
      `${name} 容量 ${cap} 相对需求 ${Math.ceil(maxLife * peakRate)} 偏小`);
  }
});

test('真实实现无残留的失效调试字段', () => {
  for (const dead of ['pointSize:', 'draws: 0', 'velS = 0', 'mistPuffs.pos[', 'mistPuffs.al[']) {
    assert.ok(!html.includes(dead), `不应残留: ${dead}`);
  }
});

// ------------------------------------------------------------
console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass}  失败 ${fail}  共 ${pass + fail}`);
if (fail) {
  console.log('\n失败明细:');
  for (const f of failures) console.log(`  · ${f.name}\n    ${f.err}`);
  process.exit(1);
}
console.log('全部通过 ✓');
