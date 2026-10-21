# Demo 模式 —— 录屏展示用

一键进入自动演示，**机位按动作阶段自动轮切**，适合录屏/发社交平台。

## 启动方式

```bash
cd outputs && python3 -m http.server 8000
# 浏览器打开:
#   http://localhost:8000/index.html?demo=1
```

或在页面里按 <kbd>D</kbd> 切换进出 Demo 模式。

## URL 参数

| 参数 | 值 | 作用 |
|------|----|------|
| `demo` | `1` | 开机直接进入演示模式 |
| `demo` | `0` | 开机不进入（默认） |
| `once` | `1` | 播完停在结尾，不循环（配合 `demo=1`） |
| `speed` | `0.25`–`4` | 播放倍速。`0.5` = 半速慢放，`2` = 双倍速 |

示例：
```
index.html?demo=1                # 正常速度，循环
index.html?demo=1&once=1         # 正常速度，播完停
index.html?demo=1&speed=0.5     # 半速慢放，循环
```

## 机位编排表

机位切换**对齐动作阶段**，不是机械定时：

| 时间 | 机位 | 内容 | 为什么用这个机位 |
|------|------|------|-----------------|
| 0.00–0.90s | `WIDE` | 开场全景 | 先交代场地与 C 形坡道全貌 |
| 0.90–2.20s | `TRACKING` | 助跑 | 贴地跟车，看清车身侧面轮廓 |
| 2.20–4.20s | `CRANE` | 爬坡升空 | 高空俯视，看清坡道 C 形曲面 |
| 4.20–6.10s | `LOW HERO` | 磁吸 · 倒挂 | 从坡道下方仰拍，**最戏剧**的一镜 |
| 6.10–8.60s | `TRACKING` | 脱轨 · 喷气 | 跟车，看喷气方向与车体分离 |
| 8.60–10.10s | `CRANE` | 空中翻正 | 高空俯视，看 180° 翻转过程 |
| 10.10–11.60s | `LOW HERO` | 缓降 | 仰拍，看车头朝下缓降 |
| 11.60s+ | `TRACKING` | 落地触地 | 近景收尾，看清车落地姿态与尾灯 |

**编排逻辑**: 远(CRANE/WIDE) → 近(TRACKING/LOW HERO) 交替,
避免连续同景别; 三个"戏眼"分别给 CRANE 爬坡、LOW HERO 倒挂、LOW HERO 缓降。

四个机位（<kbd>C</kbd> 循环切换 / <kbd>1</kbd>–<kbd>4</kbd> 直选）：

| 键 | 名称 | FOV | 说明 |
|----|------|-----|------|
| 1 | `TRACKING` | 30 | 贴地跟车(落地近景收尾) |
| 2 | `LOW HERO` | 28 | 低角度英雄机位，倒挂时切到车底侧 |
| 3 | `CRANE` | 36 | 高空俯视 |
| 4 | `WIDE` | 38 | 大全景(开场交代环境) |

## Demo 模式的 UI

- 顶部**红色 `DEMO MODE` 徽章**（带呼吸闪烁）—— 录屏时一眼看出是演示模式
- 底部**机位横幅**：显示当前机位名 + 该段内容（如 `LOW HERO · 磁吸 · 倒挂`），切机位时淡入 2.2s
- 操作提示面板（`hint`）自动隐藏 —— 画面更干净

## 编程接口

```js
window.__RD__.demo.on          // 是否在 demo 模式
window.__RD__.demo.enter()     // 进入
window.__RD__.demo.exit()      // 退出
window.__RD__.demo.toggle()    // 切换
window.__RD__.demo.shots       // 机位编排表
window.__RD__.demo.shot        // 当前镜头 { i, s: { t0,t1,v,name,note } }
```

## 展示素材

`npm run demo` 会把 7 个机位各截一张到 `ref/demo/`:
`a-approach` / `b-climb` / `c-inverted` / `d-jet` / `e-roll` / `f-cushion` / `g-land`

## 注意

- Demo 模式下按 <kbd>C</kbd> / <kbd>1</kbd>–<kbd>4</kbd> **不会**改机位（编排表接管），退出 Demo 后恢复手动控制。
- 播完默认**自动重播**（`demoLoop = true`），录屏时可以无缝接上第二遍。
