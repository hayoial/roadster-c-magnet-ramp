# Roadster @ C-Magnet Ramp

Tesla Roadster 在得州 SpaceX 测试场完成 C 形磁吸坡道倒挂测试的实时 3D 动画。

Three.js 负责场景与物理表现，SVG 负责遥测 HUD 与坡道侧视示意图。

## 运行

```bash
./fetch-deps.sh          # 拉取 three.js 及 postprocessing 依赖
python3 -m http.server 8000 --directory outputs
# 打开 http://127.0.0.1:8000
```

需要用 HTTP 访问（ES module + importmap 不能走 `file://`）。

## 时间轴（12.75s）

| 阶段 | 关键量 |
|------|--------|
| APPROACH | 地面助跑 14→20 m/s |
| CLIMB | 沿 C 形坡道冲刺，至 15m 高 |
| MAG CAPTURE | 磁吸等减速捕获，负 g 过载 −1.3→−0.5 |
| INVERTED HOLD | 车底吸附，180° 完全倒挂静止 1 秒 |
| DESCENT | 车底反推冷气缓降 |
| ROLL RECOVERY | 4 次侧向冷气脉冲驱动 0→180° 横滚回正 |
| AIRSAC CUSHION | 底部高压白雾缓冲，峰值 2.37g |
| TOUCHDOWN | 零速触地，避震压缩回弹 |

## 交互

| 键 | 作用 |
|----|------|
| `SPACE` | 播放 / 暂停 |
| `R` | 重置 |
| `C` | 切换机位 |
| `1`–`4` | 选定机位 |
| 拖动 | 时间轴擦洗 |

## 结构

```
outputs/
  index.html      主程序（场景 + 动画 + HUD）
  motion.js       纯运动学核心，无渲染依赖，node 与浏览器共用
  three.module.js / vendor/   第三方依赖（fetch-deps.sh 生成）
```

`motion.js` 独立于渲染层，可直接在 node 中跑物理校验：

```bash
node -e "import('./outputs/motion.js').then(m => {
  const T = m.buildTimeline();
  console.log('总时长', T.TOTAL.toFixed(2), 's');
})"
```

## 关键设计

**坡道几何** — C 形环内侧轨道，环心 `(0, R)`，扭转 `z = ½ka²`。
`rampUp(a) = (−sin a, cos a)` 恒指向环心，即车身顶面朝向。
推到 `a = π` 时车顶朝下、车悬于轨道下方 0.6m，磁吸盘压住轨道底面。

**磁吸捕获** — 恒定减速度 `cMag = v²/2d`，保证恰好停在顶点且 g 曲线连续。

**气垫缓冲** — 按剩余高度逐帧反解所需减速度：

```js
aAcc = -(vy * vy) / (2 * Math.max(0.12, h))
```

无需预设减速曲线，天然收敛到零速触地。

## 渲染注意事项

- 粒子用 `InstancedMesh` billboard 而非 `THREE.Points` —— SwiftShader 的点精灵尺寸上限会让大尺寸粒子整批被丢弃
- 相机偏移定义在车体局部坐标系（`carRight` / `carUp` / `carFwd`），固定世界坐标在车倒挂时会钻进坡道
- 自定义 lathe 剖面的三角面绕序决定法线朝向，绕序写反会导致整车发黑

## License

MIT
