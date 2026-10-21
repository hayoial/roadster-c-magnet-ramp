# ref/ — 原视频取证与视觉对照

## 内容

| 路径 | 说明 |
|------|------|
| `roadster-inverted-ramp.mp4` | 原视频（Tesla 官方演示素材，第三方站托管）。取证依据 |
| `REFERENCE-FRAMES.md` | 关键帧时间戳 + 视频可见事实（含量化） + 缺失信息 |
| `NOZZLE-SPEC.md` | 喷口表（局部位置/轴线/阶段/依据）+ 两种推进任务的区分 |
| `CAR-MODEL-DIFF.md` | 车型外观逐项差异清单（含历史值追溯） |
| `nozzle-timeline.md` | **自动生成**：9 个关键时刻的喷口激活清单（运行时实测值） |
| `video-frames/` | 9 张原视频关键帧 |
| `compare/` | 9 张原视频 vs 渲染 并排对照图（上=原视频，下=本项目） |
| `render/` | 11 张固定诊断机位渲染帧 |
| `car-views/` | 7 张车型视角（前/后/侧/前45/后45/顶/底） |

## ⚠️ 重要

该视频含**三段不同 stunt**，本项目只对应第一段：

- **0–23.5s = Run one，C 形坡道倒挂** ← 本项目
- 26–33s = Run two，踢翻车队
- 37–45s = Run three，原地螺旋

`compare/` 与 `render/` 的帧**全部取自 Run one**。

## 复现

```bash
# 单元测试（不依赖浏览器）
npm test

# 视觉工作流（需要 playwright + Chrome）
npm i -D playwright          # 或设置 PLAYWRIGHT_PATH 指向已有安装
npm run test:visual          # 四套: gallery / frames / compare / nozzles
npm run test:visual:compare  # 只跑并排对照
npm run test:nozzles         # 只跑喷口物理语义断言
npm run test:all             # 单元 + 视觉
```

**路径与端口全部可配置**（`tests/_harness.mjs`）：

| 变量 | 作用 | 默认 |
|------|------|------|
| `PLAYWRIGHT_PATH` | playwright 的 index.mjs 路径 | 自动逐级向上找 `node_modules` |
| `CHROME_PATH` | Chrome 可执行文件 | 按平台探测常见安装位置 |
| `RD_BASE` | 外部已启动的服务地址 | 自动选空闲端口起临时服务 |

`tests/_harness.mjs` 会**自动选空闲端口**并起临时静态服务，测试结束自动关闭 ——
不再硬编码 `localhost:8765`，多套工作流可并行跑。

## ⚠️ 截图成功 ≠ 视觉还原正确

`npm run test:visual` 只保证**流程通过**（页面能跑、截图能出）。
验收必须**人工检查**：

- `ref/compare/` — 车型轮廓 / 倒挂姿态 / 光束数量与方向 / 缓降时序 / 触地蒸汽云
- `ref/car-views/` — 前/后/侧/前45/后45 的车型可识别性
