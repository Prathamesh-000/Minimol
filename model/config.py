"""Single architecture contract and stable configuration identity."""

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ModelConfig:
    model_id: str = "minimol-byte-gpt-v1"
    architecture: str = "pre-ln-causal-gpt"
    vocab_size: int = 256
    max_seq_len: int = 512
    n_layers: int = 6
    hidden_dim: int = 384
    n_heads: int = 6
    head_dim: int = 64
    ff_dim: int = 1536
    layer_norm_eps: float = 1e-5
    gelu_approximate: str = "none"
    linear_bias: bool = True
    lm_head_bias: bool = False
    tie_embeddings: bool = False
    dtype: str = "float32"
    split_layer: int = 3
    parameter_count: int = 11_040_768

    def validate(self) -> None:
        actual, expected = self.to_dict(), asdict(ModelConfig())
        if actual != expected or any(type(actual[k]) is not type(expected[k]) for k in expected):
            raise ValueError("Configuration differs from the exact miniMol v1 contract")
        if self.hidden_dim != self.n_heads * self.head_dim:
            raise ValueError("hidden_dim must equal n_heads * head_dim")

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def sha256(self) -> str:
        encoded = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def load_config(path: Path = ROOT / "model/model_config.json") -> ModelConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if set(raw) != set(asdict(ModelConfig())):
        raise ValueError("Configuration must contain every contract field exactly once")
    config = ModelConfig(**raw)
    config.validate()
    return config
