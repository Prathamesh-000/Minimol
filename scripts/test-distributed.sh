#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
mkdir -p artifacts/reports
npm run build
node --test --test-concurrency=1 --test-reporter=spec tests/networking/*.test.mjs tests/distributed/*.test.mjs | tee artifacts/reports/milestone3-tests.txt
