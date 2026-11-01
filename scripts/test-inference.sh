#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
mkdir -p artifacts/reports
npm run build
node --test --test-concurrency=1 --test-reporter=spec tests/inference/*.test.mjs | tee artifacts/reports/milestone2-tests.txt
