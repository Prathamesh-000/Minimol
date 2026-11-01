#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
python_bin="${MINIMOL_PYTHON:-$project_root/.venv/bin/python}"
"$python_bin" -m model.generate_weights "$@"
