"""Generate full weights.bin, role shards, JSON manifest and golden fixtures.

Run from the repo root: python ml/export_weights.py
No network access; all exported tensors are FP32 little-endian C-order.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

import numpy as np
import torch

from model import create_seeded_model, EXPECTED_PARAMS

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "ml" / "artifacts"
PUBLIC = ROOT / "web" / "public" / "model"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def role_for(name):
    if name.startswith("token_embedding.") or name.startswith("position_embedding."):
        return "phone1"
    if name.startswith("blocks."):
        idx = int(name.split(".")[1])
        return "phone1" if idx < 3 else "phone2"
    if name.startswith("ln_f.") or name.startswith("head."):
        return "phone2"
    raise ValueError(f"Unassigned tensor: {name}")


def floats_le(tensor):
    arr = tensor.detach().cpu().float().contiguous().numpy()
    return np.asarray(arr, dtype="<f4", order="C").tobytes(order="C")


def fixtures(model):
    results = []
    for prompt, take in [("A", 3), ("Hi", 3), ("Mesh", 2), ("é", 2)]:
        ids = list(prompt.encode("utf-8"))
        rows = []
        for _ in range(take):
            with torch.no_grad():
                logits, cut = model(torch.tensor([ids], dtype=torch.long), return_cut=True)
            last_logits = logits[0, -1].tolist()
            predicted = int(logits[0, -1].argmax().item())
            rows.append({"context": ids.copy(), "position": len(ids) - 1,
                         "cut": cut[0, -1].tolist(), "logits": last_logits,
                         "predictedByte": predicted})
            ids.append(predicted)
        results.append({"prompt": prompt, "promptBytes": list(prompt.encode("utf-8")),
                        "steps": rows})
    return {"note": "Provisional reference; NOT an official organizer oracle.",
            "comparisonAbsTolerance": 0.001, "runs": results}


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    model = create_seeded_model()
    full = bytearray()
    shards = {"phone1": bytearray(), "phone2": bytearray()}
    tensors = []
    for name, param in model.named_parameters():
        raw = floats_le(param)
        role = role_for(name)
        entry = {"name": name, "shape": list(param.shape), "count": param.numel(),
                 "role": role, "dtype": "float32", "byteOrder": "little",
                 "byteOffset": len(shards[role]), "byteLength": len(raw),
                 "fullByteOffset": len(full)}
        tensors.append(entry)
        shards[role].extend(raw)
        full.extend(raw)

    assert len(full) == EXPECTED_PARAMS * 4, len(full)
    assert len(shards["phone1"]) == 5_618_304 * 4
    assert len(shards["phone2"]) == 5_422_464 * 4
    (ARTIFACTS / "weights.bin").write_bytes(full)
    for role, blob in shards.items():
        (PUBLIC / f"{role}.bin").write_bytes(blob)
    spec = json.loads((ROOT / "shared" / "model-spec.json").read_text())
    manifest = {"schemaVersion": 1, "spec": spec,
                "initializer": "PyTorch default nn.Embedding + nn.Linear creation-order initialization, torch.manual_seed(42)",
                "torchVersion": torch.__version__,
                "fullWeights": {"file": "weights.bin", "byteLength": len(full), "sha256": digest(full)},
                "shards": {role: {"file": f"{role}.bin", "byteLength": len(raw), "sha256": digest(raw)}
                           for role, raw in shards.items()},
                "tensors": tensors}
    (PUBLIC / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (ARTIFACTS / "manifest.json").write_text(json.dumps(manifest, indent=2))
    golden = fixtures(model)
    (PUBLIC / "fixtures.json").write_text(json.dumps(golden))
    (ARTIFACTS / "fixtures.json").write_text(json.dumps(golden))
    print("Parameter count:", EXPECTED_PARAMS)
    print("Full weights SHA256:", digest(full))
    print("Phone 1 / 2 bytes:", len(shards["phone1"]), len(shards["phone2"]))
    print("Weights, manifest and fixtures generated. Web assets in web/public/model/")


if __name__ == "__main__":
    main()
