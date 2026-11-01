"""Independent size/schema/hash/finiteness and exact reconstruction verification.

This module does not construct the model or import PyTorch. Hashes are necessary
but insufficient: a self-consistent malicious manifest must not redefine shapes,
ownership, counts, offsets, names or file paths.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re

import numpy as np

from model.config import ROOT, ModelConfig, load_config
from model.weight_format import FILE_NAMES, FORMAT_VERSION, ROLE_COUNTS, tensor_manifest


class VerificationError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def exact_json(actual, expected) -> bool:
    """Python considers True == 1 == 1.0; the binary schema must not do so."""
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(exact_json(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(exact_json(a, b) for a, b in zip(actual, expected, strict=True))
    return actual == expected


def validate_manifest(manifest: dict, *, include_full: bool) -> ModelConfig:
    require(isinstance(manifest, dict), "Manifest must be an object")
    config = load_config()
    for field, expected in {
        "format_version": FORMAT_VERSION, "dtype": "float32", "byte_order": "little",
        "layout": "row-major", "model_config": config.to_dict(), "config_sha256": config.sha256,
        "parameter_count": config.parameter_count, "tensors": tensor_manifest(config),
    }.items():
        require(exact_json(manifest.get(field), expected), f"Invalid manifest {field}")
    expected_files = {"phone1", "phone2", "full"} if include_full else {"phone1", "phone2"}
    files = manifest.get("files")
    require(isinstance(files, dict) and set(files) == expected_files, "Invalid file ownership/list")
    for role, record in files.items():
        require(isinstance(record, dict), f"Invalid {role} file record")
        count = config.parameter_count if role == "full" else ROLE_COUNTS[role]
        require(record.get("name") == FILE_NAMES[role], f"Invalid {role} file name")
        require(exact_json(record.get("byte_length"), count * 4), f"Invalid {role} manifest size")
        require(exact_json(record.get("parameter_count"), count), f"Invalid {role} parameter count")
        require(isinstance(record.get("sha256"), str) and bool(re.fullmatch(r"[0-9a-f]{64}", record["sha256"])),
                f"Invalid {role} SHA-256 syntax")
    generation = manifest.get("generation", {})
    require(isinstance(generation, dict), "Invalid generation metadata")
    for field, expected in {"seed": 42, "pytorch_version": "2.5.1", "numpy_version": "2.1.3",
                            "device": "cpu", "dtype": "float32", "num_threads": 1,
                            "deterministic_algorithms": True,
                            "initialization": "pytorch-module-defaults",
                            "construction_order": "minimol-v1-token-position-blocks-ln-head"}.items():
        require(exact_json(generation.get(field), expected), f"Invalid generation {field}")
    return config


def verify_file(path: Path, record: dict, expected_count: int) -> bytes:
    require(path.is_file(), f"Missing weight file: {path}")
    require(path.stat().st_size == expected_count * 4, f"File size mismatch: {path.name}")
    data = path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == record["sha256"], f"SHA-256 mismatch: {path.name}")
    values = np.frombuffer(data, dtype="<f4")
    require(values.size == expected_count, f"FP32 element count mismatch: {path.name}")
    require(bool(np.isfinite(values).all()), f"Nonfinite FP32 weights: {path.name}")
    return data


def verify_role(public_dir: Path, role: str) -> tuple[dict, bytes]:
    require(role in ROLE_COUNTS, "Role must be phone1 or phone2")
    manifest = json.loads((public_dir / "manifest.json").read_text(encoding="utf-8"))
    validate_manifest(manifest, include_full=False)
    # Only this role's file is opened. Metadata for the peer does not authorize a load.
    payload = verify_file(public_dir / FILE_NAMES[role], manifest["files"][role], ROLE_COUNTS[role])
    return manifest, payload


def verify_bundle(canonical_dir: Path | None, public_dir: Path) -> dict:
    public = json.loads((public_dir / "manifest.json").read_text(encoding="utf-8"))
    config = validate_manifest(public, include_full=False)
    require(not (public_dir / "weights.bin").exists(), "Full weights must not be public")
    payloads = {
        role: verify_file(public_dir / FILE_NAMES[role], public["files"][role], count)
        for role, count in ROLE_COUNTS.items()
    }
    if canonical_dir is not None:
        internal = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
        validate_manifest(internal, include_full=True)
        expected_public = {**internal, "files": {role: internal["files"][role] for role in ROLE_COUNTS}}
        require(public == expected_public, "Public and canonical manifest mismatch")
        full = verify_file(canonical_dir / "weights.bin", internal["files"]["full"], config.parameter_count)
        require(full == payloads["phone1"] + payloads["phone2"], "Shards do not reconstruct canonical weights")
        files = internal["files"]
    else:
        files = public["files"]
    return {"status": "verified", "parameter_count": config.parameter_count,
            "tensor_count": len(public["tensors"]), "config_sha256": config.sha256,
            "all_weights_finite_fp32": True, "exact_reconstruction": canonical_dir is not None,
            "files": files}


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify exact miniMol tensor schema, FP32 files and shard integrity")
    parser.add_argument("--canonical-dir", type=Path, default=ROOT / "artifacts/model")
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/model")
    parser.add_argument("--public-only", action="store_true")
    args = parser.parse_args()
    try:
        report = verify_bundle(None if args.public_only else args.canonical_dir, args.public_dir)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Weight verification FAILED: {error}\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
