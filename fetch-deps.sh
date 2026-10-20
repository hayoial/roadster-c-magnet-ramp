#!/usr/bin/env bash
# 拉取第三方依赖（three.js 0.160.0 + postprocessing addons）
# 仓库不收录 vendor/ 与 three.module.js，克隆后执行本脚本即可本地运行。
set -euo pipefail

cd "$(dirname "$0")/outputs"

VER="0.160.0"
BASE="https://unpkg.com/three@${VER}"
ADDONS=(
  postprocessing/EffectComposer.js
  postprocessing/Pass.js
  postprocessing/RenderPass.js
  postprocessing/ShaderPass.js
  postprocessing/MaskPass.js
  postprocessing/UnrealBloomPass.js
  postprocessing/OutputPass.js
  shaders/CopyShader.js
  shaders/LuminosityHighPassShader.js
  shaders/OutputShader.js
  environments/RoomEnvironment.js
)

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ 缺少命令: $1" >&2; exit 1; }; }
need curl

if ! curl -fsS --max-time 20 -o /dev/null "$BASE/build/three.module.js"; then
  echo "✗ 无法访问 $BASE —— 请检查网络或代理设置" >&2
  exit 1
fi

echo "→ three.module.js (${VER})"
curl -fsS --max-time 120 -o three.module.js "$BASE/build/three.module.js"

echo "→ addons (${#ADDONS[@]} 个)"
for f in "${ADDONS[@]}"; do
  mkdir -p "vendor/addons/$(dirname "$f")"
  printf '  - %s\n' "$f"
  curl -fsS --max-time 60 -o "vendor/addons/$f" "$BASE/examples/jsm/$f"
done

echo "✓ 依赖就绪 → outputs/three.module.js + outputs/vendor/"
