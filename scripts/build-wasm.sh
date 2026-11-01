#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
if [[ -n "${MINIMOL_WASM_CXX:-}" ]]; then
  compiler="$MINIMOL_WASM_CXX"
elif [[ -x .tools/wasi-sdk-25.0-arm64-macos/bin/clang++ ]]; then
  compiler="$project_root/.tools/wasi-sdk-25.0-arm64-macos/bin/clang++"
elif command -v em++ >/dev/null 2>&1; then
  compiler="$(command -v em++)"
else
  echo 'No WASM compiler. Set MINIMOL_WASM_CXX to WASI SDK clang++ (or install Emscripten). TypeScript scalar inference remains available.' >&2
  exit 2
fi
mkdir -p public/wasm
common=(-O3 -std=c++17 -nostdlib -ffreestanding -fno-builtin -fno-exceptions -fno-rtti -ffp-contract=off -fno-fast-math
  -Wl,--no-entry -Wl,--export=matvec -Wl,--export=kernel_version -Wl,--export=kernel_simd
  -Wl,--export=__heap_base -Wl,--export-memory -Wl,--initial-memory=131072 -Wl,--max-memory=67108864)
if [[ "$compiler" != *em++ ]]; then common+=(--target=wasm32-unknown-unknown); fi
"$compiler" "${common[@]}" -fno-vectorize -fno-slp-vectorize wasm/src/matrix.cpp -o public/wasm/matrix-scalar.wasm
"$compiler" "${common[@]}" -msimd128 wasm/src/matrix.cpp -o public/wasm/matrix-simd.wasm
"$compiler" --version
ls -lh public/wasm/matrix-scalar.wasm public/wasm/matrix-simd.wasm
