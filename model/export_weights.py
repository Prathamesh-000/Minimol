"""Canonical FP32 export and standalone re-partitioning, without pickle files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import tempfile

import numpy as np
import torch

from model.config import ROOT, ModelConfig
from model.reference_model import ReferenceTransformer, SEED
from model.weight_format import FILE_NAMES, FORMAT_VERSION, ROLE_COUNTS, tensor_manifest, tensor_schema


def write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path: Path, data: dict) -> None:
    write_bytes_atomic(path, (json.dumps(data, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8"))


def file_record(name: str, payload: bytes) -> dict:
    return {"name": name, "byte_length": len(payload), "parameter_count": len(payload) // 4,
            "sha256": hashlib.sha256(payload).hexdigest()}


def generator_metadata() -> dict:
    if torch.__version__ != "2.5.1" or np.__version__ != "2.1.3":
        raise ValueError("Canonical generation requires torch==2.5.1 and numpy==2.1.3")
    if torch.get_num_threads() != 1 or not torch.are_deterministic_algorithms_enabled():
        raise ValueError("Canonical export requires the deterministic single-thread CPU setup")
    return {"seed": SEED, "pytorch_version": torch.__version__, "numpy_version": np.__version__,
            "python_version": platform.python_version(), "machine": platform.machine(),
            "device": "cpu", "dtype": "float32", "num_threads": 1,
            "deterministic_algorithms": True, "initialization": "pytorch-module-defaults",
            "construction_order": "minimol-v1-token-position-blocks-ln-head"}


def validate_output_directories(canonical_dir: Path, public_dir: Path) -> None:
    canonical = canonical_dir.resolve()
    if canonical.is_relative_to((ROOT / "public").resolve()) or canonical.is_relative_to(public_dir.resolve()):
        raise ValueError("Canonical full weights must remain outside public/")


def export_reference(model: ReferenceTransformer, canonical_dir: Path, public_dir: Path) -> dict:
    """Validate the whole tensor contract before publishing any file."""
    validate_output_directories(canonical_dir, public_dir)
    config = model.config
    schema = tensor_schema(config)
    parameters = dict(model.named_parameters())
    if list(parameters) != [spec.name for spec in schema]:
        raise ValueError("Parameter names/order differ from canonical schema")
    chunks = []
    for spec in schema:
        tensor = parameters[spec.name].detach()
        if tuple(tensor.shape) != spec.shape or tensor.dtype != torch.float32 or tensor.device.type != "cpu":
            raise ValueError(f"Invalid tensor shape/dtype/device: {spec.name}")
        if not bool(torch.isfinite(tensor).all()):
            raise ValueError(f"Nonfinite weight: {spec.name}")
        chunks.append(tensor.contiguous().numpy().astype("<f4", copy=False).tobytes(order="C"))
    full = b"".join(chunks)
    if len(full) != config.parameter_count * 4:
        raise ValueError("Canonical weight length mismatch")
    manifest = {
        "format_version": FORMAT_VERSION, "dtype": "float32", "byte_order": "little",
        "layout": "row-major", "model_config": config.to_dict(), "config_sha256": config.sha256,
        "parameter_count": config.parameter_count, "generation": generator_metadata(),
        "tensors": tensor_manifest(config), "files": {"full": file_record("weights.bin", full)},
    }
    write_bytes_atomic(canonical_dir / "weights.bin", full)
    return _publish_shards(full, manifest, canonical_dir, public_dir)


def _publish_shards(full: bytes, manifest: dict, canonical_dir: Path, public_dir: Path) -> dict:
    boundary = ROLE_COUNTS["phone1"] * 4
    payloads = {"phone1": full[:boundary], "phone2": full[boundary:]}
    for role, data in payloads.items():
        if len(data) != ROLE_COUNTS[role] * 4:
            raise ValueError(f"Invalid {role} size")
        write_bytes_atomic(public_dir / FILE_NAMES[role], data)
        manifest["files"][role] = file_record(FILE_NAMES[role], data)
    # Commit manifests last; partial/stale bundles fail integrity verification.
    public_manifest = {**manifest, "files": {role: manifest["files"][role] for role in ROLE_COUNTS}}
    write_json(public_dir / "manifest.json", public_manifest)
    write_json(canonical_dir / "manifest.json", manifest)
    return manifest


def repartition(canonical_dir: Path, public_dir: Path) -> dict:
    from model.verify_weights import validate_manifest, verify_file

    validate_output_directories(canonical_dir, public_dir)
    manifest = json.loads((canonical_dir / "manifest.json").read_text(encoding="utf-8"))
    validate_manifest(manifest, include_full=True)
    verify_file(canonical_dir / "weights.bin", manifest["files"]["full"], 11_040_768)
    return _publish_shards((canonical_dir / "weights.bin").read_bytes(), manifest, canonical_dir, public_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-export role shards from verified canonical full weights")
    parser.add_argument("--canonical-dir", type=Path, default=ROOT / "artifacts/model")
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public/model")
    args = parser.parse_args()
    manifest = repartition(args.canonical_dir, args.public_dir)
    print(json.dumps({"status": "exported", "files": manifest["files"]}, indent=2))


if __name__ == "__main__":
    main()
