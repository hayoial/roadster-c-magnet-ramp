#!/usr/bin/env bash
# 拉取第三方依赖（three.js + postprocessing addons）
# 仓库不收录 vendor，克隆后执行本脚本即可本地运行
set -euo pipefail
cd "$(dirname "$0")/outputs"

VER="0.160.0"
BASE="https://unpkg.com/three@${VER}"

echo "→ three.module.js"
curl -fsSL -o three.module.js "${BASE}/build/three.module.js"

echo "→ postprocessing addons"
mkdir -p vendor/addons/postprocessing vendor/addons/shaders vendor/addons/environments
for f in postprocessing/EffectComposer.js postprocessing/Pass.js postprocessing/RenderPass.js \
         postprocessing/ShaderPass.js postprocessing/MaskPass.js postprocessing/UnrealBloomPass.js \
         postprocessing/OutputPass.js shaders/CopyShader.js shaders/LuminosityHighPassShader.js \
         shaders/OutputShader.js environments/RoomEnvironment.js; do
  mkdir -p "vendor/addons/$(dirname "$f")"
  echo "  - $f"
  curl -fsSL -o "vendor/addons/$f" "${BASE}/examples/jsm/$f"
done

echo "✓ 依赖就绪"
