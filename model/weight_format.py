"""Independent tensor schema: never infer architecture from a supplied manifest."""

from dataclasses import dataclass
import hashlib
import math
from pathlib import Path

from model.config import ModelConfig

FORMAT_VERSION = 1
ROLE_COUNTS = {"phone1": 5_618_304, "phone2": 5_422_464}
FILE_NAMES = {"full": "weights.bin", "phone1": "phone1.bin", "phone2": "phone2.bin"}


@dataclass(frozen=True)
class TensorSpec:
    name: str
    shape: tuple[int, ...]
    owner: str

    @property
    def numel(self) -> int:
        return math.prod(self.shape)


def tensor_schema(config: ModelConfig) -> list[TensorSpec]:
    config.validate()
    h, f = config.hidden_dim, config.ff_dim
    specs = [
        TensorSpec("token_embedding.weight", (config.vocab_size, h), "phone1"),
        TensorSpec("position_embedding.weight", (config.max_seq_len, h), "phone1"),
    ]
    for layer in range(config.n_layers):
        owner = "phone1" if layer < config.split_layer else "phone2"
        for suffix, shape in [
            ("ln1.weight", (h,)), ("ln1.bias", (h,)),
            ("attn.qkv.weight", (3 * h, h)), ("attn.qkv.bias", (3 * h,)),
            ("attn.proj.weight", (h, h)), ("attn.proj.bias", (h,)),
            ("ln2.weight", (h,)), ("ln2.bias", (h,)),
            ("mlp.fc1.weight", (f, h)), ("mlp.fc1.bias", (f,)),
            ("mlp.fc2.weight", (h, f)), ("mlp.fc2.bias", (h,)),
        ]:
            specs.append(TensorSpec(f"blocks.{layer}.{suffix}", shape, owner))
    specs.extend([
        TensorSpec("final_ln.weight", (h,), "phone2"),
        TensorSpec("final_ln.bias", (h,), "phone2"),
        TensorSpec("lm_head.weight", (config.vocab_size, h), "phone2"),
    ])
    if sum(s.numel for s in specs) != config.parameter_count:
        raise ValueError("Tensor schema does not match exact parameter count")
    return specs


def tensor_manifest(config: ModelConfig) -> list[dict]:
    canonical_offset = 0
    role_offsets = {role: 0 for role in ROLE_COUNTS}
    tensors = []
    for spec in tensor_schema(config):
        size = spec.numel * 4
        tensors.append({
            "name": spec.name, "shape": list(spec.shape), "dtype": "float32",
            "numel": spec.numel, "byte_length": size, "owner": spec.owner,
            "canonical_offset_bytes": canonical_offset,
            "offset_bytes": role_offsets[spec.owner],
        })
        canonical_offset += size
        role_offsets[spec.owner] += size
    if role_offsets != {role: count * 4 for role, count in ROLE_COUNTS.items()}:
        raise ValueError("Shard parameter counts differ from specification")
    return tensors


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
