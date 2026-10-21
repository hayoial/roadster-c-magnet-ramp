# 车顶玻璃"透明感"修复

## L 的判断
> 「车顶盖感觉还是90%透明的感觉，完全能看到车内不，导致看着没厚度，改成25%透明最多了」

**完全正确**，而且指出了一个我前几轮完全没看到的层面。

## 根因

### 主因：`transmission` 绕过 `opacity`
旧玻璃材质：
```js
color: 0x0b1219, roughness: 0.10, metalness: 0.45,
transmission: 0.18, thickness: 0.20, transparent: true, opacity: 0.86,
```

`transmission` 是 **MeshPhysicalMaterial 的物理透射**（真实折射+透光），
它**不经过 opacity 的衰减**。opacity 0.86 只挡住了 14% 的 alpha，
剩下的光靠 transmission 照样进来 → 看起来就是"90% 透明"。

**关键实测**：只降 opacity 完全没用——
| 变体 | 效果 |
|---|---|
| tr=0.18 op=0.86（旧） | 半透明板，能看见底下结构 |
| tr=0 op=0.86 | 仍偏透 |
| tr=0 op=0.55 | 仍偏透 |
| tr=0 op=0.35 | **反而发白**（半透时只剩反射） |
| tr=0 op=0.25 | **反而发白** |
| **tr=0 op=1.0** | **实心深色玻璃，完全看不穿** ✓ |

→ **必须 `transmission = 0` 且 `opacity = 1.0`**。
L 说的"25%透明最多"在**这种暗环境 + 高反射的车漆**下反而是最差选择：
半透明时材质只剩反射，看起来是灰白板子而不是玻璃。

### 附带发现：磁吸盘从车顶穿帮
底板下探到 0.232 后，磁吸盘（半径 0.78m）被包在车壳内，
而车顶玻璃只覆盖半宽 0.497m → **顶视时磁吸盘从车壳里露出来**（一个大黑圆）。

用"逐个隐藏"隔离验证：
- 隐藏玻璃 → 黑圆仍在 → 黑圆不是玻璃
- 隐藏磁吸环 → 青环消失、黑圆仍在 → **黑圆是 magPad**

**修法**：磁吸盘半径 0.78 → **0.44**（小于玻璃覆盖半宽 0.497），
magRing 0.78→0.44，内圈 0.28+k*0.20 → 0.16+k*0.11。
（磁吸盘是装饰性辉光盘，缩到玻璃覆盖范围内不影响效果）

## 最终材质
```js
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x0a1017, roughness: 0.08, metalness: 0.55,
  transmission: 0.0, thickness: 0.20, transparent: false, opacity: 1.0,
  ior: 1.5, envMapIntensity: 1.05,
});
```
深色镀膜天幕 —— 从外面看是一整块深色玻璃，完全看不穿车内。

## 工具
- `tests/glass-ab.mjs` —— 玻璃透明度 A/B（从上方斜 45° 看，这个角度才看得出穿不穿）
- `tests/roof-check.mjs <tag>` —— 顶视 / 前45 三视角检查

## 验证
npm test 49+19+23 全通过 | 喷口 43/43 | demo 7 机位零错误
