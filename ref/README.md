# ref/ — 原视频取证与视觉对照

## 内容

| 路径 | 说明 |
|------|------|
| `roadster-inverted-ramp.mp4` | 原视频（Tesla 官方演示素材，第三方站托管）。取证依据 |
| `REFERENCE-FRAMES.md` | 关键帧时间戳清单 + 视频可见事实 + 缺失信息 |
| `NOZZLE-SPEC.md` | 喷口表（局部位置/轴线/阶段/依据）+ 两种推进任务的区分 |
| `CAR-MODEL-DIFF.md` | 车型外观逐项差异清单 |
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
python3 -m http.server 8765 --directory outputs   # ES module 需要 http://，file:// 会被 CORS 拦
node tests/side-by-side.mjs      # 重新生成并排对照图
node tests/visual-reference.mjs  # 重新生成固定机位关键帧
node tests/gallery-shots.mjs     # 重新生成车型六视角
```
