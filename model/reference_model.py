"""Exact, development-only CPU FP32 reference. No optimized/fused attention.

Module registration order is part of the seeded initialization contract. Do not
reorder constructors or apply a post-construction initializer without versioning
the canonical weights and regenerating the golden fixtures.
"""

import math

import torch
from torch import Tensor, nn
from torch.nn import functional as F

from model.config import ModelConfig, load_config

FACTORY = {"device": "cpu", "dtype": torch.float32}
SEED = 42


def configure_reference_cpu() -> None:
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)


def validate_input_ids(ids: Tensor, config: ModelConfig) -> None:
    if not isinstance(ids, Tensor) or ids.dtype != torch.int64:
        raise ValueError("Input must be a torch.int64 tensor of byte IDs")
    if ids.device.type != "cpu":
        raise ValueError("Canonical reference inputs must be on CPU")
    if ids.ndim != 2 or ids.shape[0] < 1:
        raise ValueError("Expected a nonempty [batch, sequence] tensor")
    if not 1 <= ids.shape[1] <= config.max_seq_len:
        raise ValueError("Input sequence must contain 1–512 bytes; no BOS is defined")
    if bool(((ids < 0) | (ids >= config.vocab_size)).any()):
        raise ValueError("Byte IDs must be within 0–255")


class CausalSelfAttention(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.n_heads = config.n_heads
        self.head_dim = config.head_dim
        self.qkv = nn.Linear(config.hidden_dim, 3 * config.hidden_dim, bias=True, **FACTORY)
        self.proj = nn.Linear(config.hidden_dim, config.hidden_dim, bias=True, **FACTORY)

    def forward(self, x: Tensor) -> Tensor:
        batch, length, width = x.shape
        # Projection ordering: all Q heads, then all K heads, then all V heads.
        q, k, v = self.qkv(x).split(width, dim=-1)
        q, k, v = (
            t.reshape(batch, length, self.n_heads, self.head_dim).transpose(1, 2)
            for t in (q, k, v)
        )
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        future = torch.ones(length, length, dtype=torch.bool, device=x.device).triu(1)
        scores = scores.masked_fill(future, float("-inf"))
        # Explicit stable softmax, avoiding a fused attention implementation.
        exponentials = torch.exp(scores - scores.amax(dim=-1, keepdim=True))
        probabilities = exponentials / exponentials.sum(dim=-1, keepdim=True)
        context = torch.matmul(probabilities, v).transpose(1, 2).contiguous()
        return self.proj(context.reshape(batch, length, width))


class MLP(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.fc1 = nn.Linear(config.hidden_dim, config.ff_dim, bias=True, **FACTORY)
        self.fc2 = nn.Linear(config.ff_dim, config.hidden_dim, bias=True, **FACTORY)

    def forward(self, x: Tensor) -> Tensor:
        return self.fc2(F.gelu(self.fc1(x), approximate="none"))


class TransformerBlock(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.ln1 = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps, **FACTORY)
        self.attn = CausalSelfAttention(config)
        self.ln2 = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps, **FACTORY)
        self.mlp = MLP(config)

    def forward(self, x: Tensor) -> Tensor:
        x = x + self.attn(self.ln1(x))
        return x + self.mlp(self.ln2(x))


class ReferenceTransformer(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        config.validate()
        self.config = config
        self.token_embedding = nn.Embedding(config.vocab_size, config.hidden_dim, **FACTORY)
        self.position_embedding = nn.Embedding(config.max_seq_len, config.hidden_dim, **FACTORY)
        self.blocks = nn.ModuleList(TransformerBlock(config) for _ in range(config.n_layers))
        self.final_ln = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps, **FACTORY)
        self.lm_head = nn.Linear(config.hidden_dim, config.vocab_size, bias=False, **FACTORY)

    def embed(self, ids: Tensor) -> Tensor:
        validate_input_ids(ids, self.config)
        positions = torch.arange(ids.shape[1], dtype=torch.int64, device="cpu")
        return self.token_embedding(ids) + self.position_embedding(positions)

    def forward_with_boundary(self, ids: Tensor) -> tuple[Tensor, Tensor]:
        x = self.embed(ids)
        boundary = None
        for index, block in enumerate(self.blocks):
            x = block(x)
            if index == self.config.split_layer - 1:
                boundary = x
        assert boundary is not None
        return self.lm_head(self.final_ln(x)), boundary

    def forward(self, ids: Tensor) -> Tensor:
        return self.forward_with_boundary(ids)[0]


class Phone1Reference(nn.Module):
    """Development export check only; owns embeddings and exactly blocks 0–2."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        config.validate()
        self.config = config
        self.token_embedding = nn.Embedding(config.vocab_size, config.hidden_dim, **FACTORY)
        self.position_embedding = nn.Embedding(config.max_seq_len, config.hidden_dim, **FACTORY)
        self.blocks = nn.ModuleDict({str(i): TransformerBlock(config) for i in range(config.split_layer)})

    def forward(self, ids: Tensor) -> Tensor:
        validate_input_ids(ids, self.config)
        positions = torch.arange(ids.shape[1], dtype=torch.int64, device="cpu")
        x = self.token_embedding(ids) + self.position_embedding(positions)
        for block in self.blocks.values():
            x = block(x)
        return x


class Phone2Reference(nn.Module):
    """Development export check only; owns blocks 3–5, final LN and head."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        config.validate()
        self.config = config
        self.blocks = nn.ModuleDict({
            str(i): TransformerBlock(config) for i in range(config.split_layer, config.n_layers)
        })
        self.final_ln = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps, **FACTORY)
        self.lm_head = nn.Linear(config.hidden_dim, config.vocab_size, bias=False, **FACTORY)

    def forward(self, activation: Tensor) -> Tensor:
        if (activation.dtype != torch.float32 or activation.device.type != "cpu"
                or activation.ndim != 3 or activation.shape[0] < 1
                or not 1 <= activation.shape[1] <= self.config.max_seq_len
                or activation.shape[2] != self.config.hidden_dim
                or not bool(torch.isfinite(activation).all())):
            raise ValueError("Expected finite CPU float32 [batch, 1..512, 384] activation")
        x = activation
        for block in self.blocks.values():
            x = block(x)
        return self.lm_head(self.final_ln(x))


def build_reference(config: ModelConfig | None = None) -> ReferenceTransformer:
    config = config or load_config()
    configure_reference_cpu()
    torch.manual_seed(SEED)
    model = ReferenceTransformer(config).eval()
    actual = sum(parameter.numel() for parameter in model.parameters())
    if actual != config.parameter_count:
        raise ValueError(f"Parameter mismatch: {actual} != {config.parameter_count}")
    return model


def greedy_next_byte(logits: Tensor) -> Tensor:
    if logits.shape[-1:] != (256,) or not bool(torch.isfinite(logits).all()):
        raise ValueError("Expected finite logits with 256 vocabulary entries")
    # torch.argmax returns the first index in a tie: the lowest byte ID.
    return torch.argmax(logits, dim=-1)


@torch.inference_mode()
def generate_reference(model: ReferenceTransformer, prompt: bytes, max_new_bytes: int) -> list[int]:
    """Slow full-prefix oracle; incremental production KV caching belongs to M2."""
    if not isinstance(prompt, bytes) or not 1 <= len(prompt) <= model.config.max_seq_len:
        raise ValueError("Prompt must be 1–512 raw bytes")
    if type(max_new_bytes) is not int or max_new_bytes < 0:
        raise ValueError("max_new_bytes must be a nonnegative integer")
    context = list(prompt)
    generated = []
    while len(generated) < max_new_bytes and len(context) <= model.config.max_seq_len:
        logits = model(torch.tensor([context], dtype=torch.int64))
        byte = int(greedy_next_byte(logits[0, -1]))
        generated.append(byte)
        context.append(byte)
    return generated
