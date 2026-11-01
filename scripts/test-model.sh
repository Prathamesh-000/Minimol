#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
python_bin="${MINIMOL_PYTHON:-$project_root/.venv/bin/python}"
mkdir -p artifacts/reports
"$python_bin" -m model.verify_weights | tee artifacts/reports/weight-verification.json
"$python_bin" -m pytest -q --junitxml=artifacts/reports/model-tests.xml | tee artifacts/reports/model-tests.txt
