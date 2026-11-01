// Freestanding CPU-only kernel: no libc, WASI, filesystem, GPU or server imports.
// Compile without FP contraction/reassociation to preserve the scalar lane order.
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

extern "C" {
int kernel_version() { return 1; }
int kernel_simd() {
#ifdef __wasm_simd128__
  return 1;
#else
  return 0;
#endif
}

void matvec(const float* weights, const float* input, const float* bias,
            float* output, int rows, int cols) {
  for (int row = 0; row < rows; ++row) {
    const float* w = weights + row * cols;
    int col = 0;
#ifdef __wasm_simd128__
    v128_t accum = wasm_f32x4_splat(0.0f);
    for (; col + 3 < cols; col += 4) {
      accum = wasm_f32x4_add(accum, wasm_f32x4_mul(wasm_v128_load(w + col), wasm_v128_load(input + col)));
    }
    float sum = ((wasm_f32x4_extract_lane(accum, 0) + wasm_f32x4_extract_lane(accum, 1))
                 + wasm_f32x4_extract_lane(accum, 2)) + wasm_f32x4_extract_lane(accum, 3);
#else
    float a = 0, b = 0, c = 0, d = 0;
    for (; col + 3 < cols; col += 4) {
      a += w[col] * input[col]; b += w[col + 1] * input[col + 1];
      c += w[col + 2] * input[col + 2]; d += w[col + 3] * input[col + 3];
    }
    float sum = ((a + b) + c) + d;
#endif
    for (; col < cols; ++col) sum += w[col] * input[col];
    output[row] = sum + (bias ? bias[row] : 0.0f);
  }
}
}
