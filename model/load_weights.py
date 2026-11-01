"""Strict development loaders. A role load opens only its own shard."""

from pathlib import Path

import numpy as np
import torch
from torch import nn

from model.config import load_config
from model.reference_model import Phone1Reference, Phone2Reference, configure_reference_cpu
from model.verify_weights import verify_role


def load_reference_role(public_dir: Path, role: str) -> nn.Module:
    manifest, payload = verify_role(public_dir, role)
    config = load_config()
    configure_reference_cpu()
    # Save/restore the caller's RNG state; random placeholder values are fully
    # replaced by the verified shard before the module can be returned.
    with torch.random.fork_rng(devices=[]):
        module = Phone1Reference(config) if role == "phone1" else Phone2Reference(config)
    state = {}
    for tensor in manifest["tensors"]:
        if tensor["owner"] != role:
            continue
        array = np.frombuffer(payload, dtype="<f4", count=tensor["numel"], offset=tensor["offset_bytes"])
        native = array.astype(np.float32, copy=True).reshape(tensor["shape"])
        state[tensor["name"]] = torch.from_numpy(native)
    module.load_state_dict(state, strict=True)
    return module.eval()
