/**
 * 喷口物理语义断言
 *
 * 原则: 断言必须【读取实际配置 + 实际姿态计算结果】, 不允许复制固定答案。
 * 本文件通过启动真实页面, seek 到关键时刻, 读取 __nozzles__() 的
 * 实际 worldDir / intensity / 位置, 再做物理语义判断。
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors } from './_harness.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const playwright = await loadPlaywright();
const srv = await serveOutputs();
const browser = await launchBrowser(playwright);
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = collectErrors(page);

await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__RD__ && window.__nozzles__, { timeout: 60000 });
await page.waitForTimeout(2500);   // headless 下 rAF 启动慢, 让主循环跑起来

/** seek 到 t 并推进 20 帧, 让喷口强度收敛 */
async function sampleAt(t) {
  await page.evaluate(tt => { window.__RD__.seek(tt); window.__RD__.playing = false; }, t);
  await advanceFrames(page, 20);
  return page.evaluate(() => {
    const RD = window.__RD__;
    const s = RD.TL.sample(RD.t);
    return {
      t: RD.t, phase: s.phase,
      up: { x: s.up.x, y: s.up.y, z: s.up.z },
      roll: s.roll,
      nozzles: window.__nozzles__(),
    };
  });
}

/** 按【阶段】而不是写死时刻取样 —— 时间轴调整后断言不会失效 */
async function sampleInPhase(phase, frac) {
  const span = await page.evaluate(ph => {
    const TL = window.__RD__.TL;
    let lo = null, hi = null;
    for (let t = 0; t <= TL.TOTAL; t += 0.01) {
      if (TL.sample(t).phase === ph) { if (lo === null) lo = t; hi = t; }
    }
    return { lo, hi };
  }, phase);
  if (span.lo === null) throw new Error(`阶段 ${phase} 不存在`);
  return sampleAt(span.lo + (span.hi - span.lo) * frac);
}

console.log('\n' + '='.repeat(58));
console.log('  喷口物理语义断言 (基于实际配置 + 实际姿态计算)');
console.log('='.repeat(58));

// ----------------------------------------------------------------
// A. 配置层: under-core 不得在车辆仍倒挂的阶段被当作"向下缓降"使用
// ----------------------------------------------------------------
console.log('\nA. under-core 阶段语义 (配置层)');
{
  const cfg = await page.evaluate(() => {
    const raw = window.__nozzlesRaw__ ? window.__nozzlesRaw__() : null;
    return raw ? raw.map(n => ({ id: n.id, type: n.type, stages: [...n.stages],
                                 localDir: [n.localDir.x, n.localDir.y, n.localDir.z],
                                 localPos: [n.localPos.x, n.localPos.y, n.localPos.z] })) : null;
  });
  ok(!!cfg, '页面暴露原始喷口配置');
  if (cfg) {
    const uc = cfg.find(n => n.id === 'under-core');
    ok(!!uc, '存在 under-core 喷口');
    if (uc) {
      ok(uc.localDir[1] < -0.99, `under-core 局部轴线朝车底 (localDir.y=${uc.localDir[1]})`);
      ok(!uc.stages.includes('descent'),
        `under-core 不在 descent 阶段激活 (stages=${uc.stages.join('/')}) — 倒挂时局部 -Y 朝上, 不能当向下缓降用`);
      ok(!uc.stages.includes('roll'),
        `under-core 不在 roll 阶段激活 (stages=${uc.stages.join('/')})`);
      ok(uc.stages.includes('cushion'),
        `under-core 在 cushion 阶段激活 (stages=${uc.stages.join('/')})`);
    }
    // 甲板主喷流: 局部轴线必须朝车顶 (+Y), 才能在倒挂时产生向下推力
    const main = cfg.filter(n => n.type === 'main');
    ok(main.length >= 2, `主喷流数量 ${main.length} >= 2`);
    ok(main.every(n => n.localDir[1] > 0.5),
      '主喷流局部轴线均朝车顶侧 (+Y) —— 倒挂时即世界向下');
  }
}

// ----------------------------------------------------------------
// B. 运行层: 各关键时刻的实际世界方向
// ----------------------------------------------------------------
console.log('\nB. 关键时刻的实际世界方向 (读取运行时结果)');

// 倒挂阶段: 主喷流必须朝世界下方
// 倒挂阶段: 在 hang/descent/roll 三个阶段各取样(按阶段定位, 不写死时刻)
const INVERTED_SAMPLES = [];
for (const ph of ['hang', 'descent', 'roll']) {
  for (const frac of [0.2, 0.6, 0.9]) INVERTED_SAMPLES.push([ph, frac]);
}
for (const [ph, frac] of INVERTED_SAMPLES) {
  const s = await sampleInPhase(ph, frac);
  const t = s.t;
  const main = s.nozzles.filter(n => n.type === 'main' && n.intensity > 0.05);
  const uc = s.nozzles.filter(n => n.id === 'under-core' && n.intensity > 0.05);
  const downMain = main.every(n => n.worldDir[1] < 0);
  // 只有当车确实还倒挂(up.y<0)时才要求主喷流朝下
  if (s.up.y < -0.05) {
    ok(downMain,
      `t=${t}s (${s.phase}, up.y=${s.up.y.toFixed(2)}) 倒挂: ${main.length} 束主喷流 worldDir.y 均<0` +
      (main[0] ? ` (${main.map(n => n.worldDir[1].toFixed(2)).join(',')})` : ''));
    ok(uc.length === 0,
      `t=${t}s 倒挂: under-core 未激活 (实际 ${uc.length} 束)`);
  } else {
    // 翻正过程中: 主喷流必须已停用(否则会变成朝上的错误推力)
    ok(main.length === 0,
      `t=${t}s (${s.phase}, up.y=${s.up.y.toFixed(2)}) 已翻正: 主喷流已停用 (实际 ${main.length} 束)`);
  }
}

// 翻正后: under-core 必须朝世界下方, 主喷流必须已停用
for (const frac of [0.15, 0.5, 0.85]) {
  const s = await sampleInPhase('cushion', frac);
  const t = s.t;
  const uc = s.nozzles.filter(n => n.id === 'under-core' && n.intensity > 0.05);
  const main = s.nozzles.filter(n => n.type === 'main' && n.intensity > 0.05);
  ok(s.up.y > 0.5, `t=${t}s (${s.phase}) 车已翻正 (up.y=${s.up.y.toFixed(2)})`);
  ok(uc.length === 1 && uc[0].worldDir[1] < -0.5,
    `t=${t}s 缓降: under-core 激活且 worldDir.y<0 (${uc.length ? uc[0].worldDir[1].toFixed(2) : 'n/a'})`);
  ok(main.length === 0,
    `t=${t}s 翻正后主喷流已停用 (实际 ${main.length} 束) —— 否则会变成朝上的错误推力`);
}

// 触地后: 定向喷流必须停止
{
  const s = await sampleInPhase('landed', 0.2);
  const dir = s.nozzles.filter(n => n.intensity > 0.05);
  ok(s.phase === 'landed', `t=11.7s 阶段为 landed (实际 ${s.phase})`);
  ok(dir.length === 0, `t=11.7s 触地后无定向喷流 (实际 ${dir.length} 束)`);
}

// ----------------------------------------------------------------
// C. 喷口位置层: 喷口必须真正安装在车身表面附近, 不能凭空
// ----------------------------------------------------------------
console.log('\nC. 喷口安装位置合理性');
{
  const s = await sampleAt(7.6);
  for (const n of s.nozzles) {
    const lp = n.localPos;
    // 车身包围盒: x∈[-2.21,2.21], y∈[0,1.11], |z|<=0.995
    const inBox = lp[0] > -2.25 && lp[0] < 2.25 && lp[1] > -0.05 && lp[1] < 1.15 && Math.abs(lp[2]) < 1.0;
    ok(inBox, `${n.id} 局部位置在车身包围盒内 (${lp.join(', ')})`);
  }
  // 喷口世界位置应与车辆世界位置一致(不能固定在世界坐标)
  const carPos = await page.evaluate(() => window.__RD__.carPos());
  const nz = s.nozzles.find(n => n.id === 'deck-rear-l');
  if (nz) {
    const d = Math.hypot(nz.worldPos[0] - carPos.x, nz.worldPos[1] - carPos.y, nz.worldPos[2] - carPos.z);
    ok(d < 4.0, `喷口世界位置随车辆移动 (与车距 ${d.toFixed(2)}m, 非固定世界坐标)`);
  }
}

// ----------------------------------------------------------------
console.log('\n' + '='.repeat(58));
console.log(`通过 ${pass}  失败 ${fail}`);
if (errors.length) { console.log('页面错误:'); errors.forEach(e => console.log('  ' + e)); }
console.log('='.repeat(58));
await browser.close();
await srv.close();
process.exit(fail || errors.length ? 1 : 0);
