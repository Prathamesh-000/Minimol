"""One reproducible command for the reference, exports, integrity and goldens."""

import argparse
import json
from pathlib import Path

from model.config import ROOT
from model.export_weights import export_reference
from model.golden_vectors import write_golden_vectors
from model.reference_model import build_reference
from model.verify_weights import verify_bundle


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate canonical seed-42 FP32 weights, verified shards and golden vectors")
    parser.add_argument("--canonical-dir", type=Path, default=ROOT / "artifacts/model")
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/model")
    parser.add_argument("--golden-path", type=Path, default=ROOT / "tests/fixtures/golden_vectors.json")
    args = parser.parse_args()
    model = build_reference()
    manifest = export_reference(model, args.canonical_dir, args.public_dir)
    report = verify_bundle(args.canonical_dir, args.public_dir)
    golden = write_golden_vectors(model, manifest, args.golden_path)
    report["golden_cases"] = len(golden["cases"])
    report["golden_path"] = str(args.golden_path)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
