"""Golden vectors bind canonical forward results to exact exported model hashes."""

from pathlib import Path

import torch

from model.export_weights import write_json
from model.reference_model import ReferenceTransformer, generate_reference, greedy_next_byte

ATOL = 1e-4
RTOL = 1e-4

CASES = [
    ("ascii_hello", b"Hello"),
    ("utf8_hindi_emoji", "नमस्ते 🌍".encode("utf-8")),
    ("utf8_accent", "café".encode("utf-8")),
    ("byte_extremes", bytes([0, 255, 128, 1, 254, 127])),
    ("single_zero", bytes([0])),
    ("single_ff", bytes([255])),
    ("maximum_context", bytes(range(256)) * 2),
]


@torch.inference_mode()
def write_golden_vectors(model: ReferenceTransformer, manifest: dict, path: Path) -> dict:
    cases = []
    for name, prompt in CASES:
        logits, boundary = model.forward_with_boundary(torch.tensor([list(prompt)], dtype=torch.int64))
        # All positions for ordinary prompts; boundary samples for 512-byte case.
        positions = list(range(len(prompt))) if len(prompt) < 512 else [0, 1, 255, 510, 511]
        samples = [{"position": position,
                    "phone1_activation": boundary[0, position].tolist(),
                    "logits": logits[0, position].tolist(),
                    "greedy_byte": int(greedy_next_byte(logits[0, position]))}
                   for position in positions]
        cases.append({"name": name, "prompt_bytes": list(prompt), "samples": samples,
                      "max_new_bytes": 8, "generated_bytes": generate_reference(model, prompt, 8)})
    result = {"format_version": 1, "model_id": model.config.model_id,
              "config_sha256": manifest["config_sha256"],
              "weight_sha256": {role: record["sha256"] for role, record in manifest["files"].items()},
              "generation": manifest["generation"],
              "tolerance": {"atol": ATOL, "rtol": RTOL, "greedy_ids_must_match": True},
              "cases": cases}
    write_json(path, result)
    return result
