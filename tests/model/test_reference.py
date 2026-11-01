import math

import pytest
import torch
from torch import nn
from torch.nn import functional as F

from model.config import ModelConfig, load_config
from model.reference_model import FACTORY, build_reference, generate_reference, greedy_next_byte
from model.weight_format import ROLE_COUNTS, tensor_manifest, tensor_schema


def test_exact_parameter_accounting_and_tensor_shapes(reference):
    assert sum(p.numel() for p in reference.parameters()) == 11_040_768
    assert reference.token_embedding.weight.numel() == 98_304
    assert reference.position_embedding.weight.numel() == 196_608
    assert len(reference.blocks) == 6
    assert [sum(p.numel() for p in b.parameters()) for b in reference.blocks] == [1_774_464] * 6
    assert sum(p.numel() for p in reference.final_ln.parameters()) == 768
    assert sum(p.numel() for p in reference.lm_head.parameters()) == 98_304
    assert reference.lm_head.bias is None
    assert reference.lm_head.weight.data_ptr() != reference.token_embedding.weight.data_ptr()
    schema = tensor_schema(reference.config)
    assert [(n, tuple(p.shape)) for n, p in reference.named_parameters()] == [(s.name, s.shape) for s in schema]
    assert len(schema) == 77
    assert all(p.dtype == torch.float32 and p.device.type == "cpu" for p in reference.parameters())
    for block in reference.blocks:
        assert block.attn.n_heads == 6 and block.attn.head_dim == 64
        assert block.ln1.eps == block.ln2.eps == 1e-5
        assert all(m.bias is not None for m in block.modules() if isinstance(m, nn.Linear))
    assert not any(isinstance(m, nn.Dropout) for m in reference.modules())


def test_stock_initialization_in_required_construction_order(reference):
    # A flat independent sequence detects accidental constructor RNG consumption.
    torch.manual_seed(42)
    modules = [nn.Embedding(256, 384, **FACTORY), nn.Embedding(512, 384, **FACTORY)]
    for _ in range(6):
        modules.extend([
            nn.LayerNorm(384, eps=1e-5, **FACTORY),
            nn.Linear(384, 1152, **FACTORY), nn.Linear(384, 384, **FACTORY),
            nn.LayerNorm(384, eps=1e-5, **FACTORY),
            nn.Linear(384, 1536, **FACTORY), nn.Linear(1536, 384, **FACTORY),
        ])
    modules.extend([nn.LayerNorm(384, eps=1e-5, **FACTORY), nn.Linear(384, 256, bias=False, **FACTORY)])
    expected = [p for module in modules for p in module.parameters()]
    assert len(expected) == len(list(reference.parameters()))
    assert all(torch.equal(a, b) for a, b in zip(reference.parameters(), expected, strict=True))


def test_repeated_seed_reproduces_every_tensor(reference):
    repeated = build_reference()
    assert all(torch.equal(a, b) for a, b in zip(reference.parameters(), repeated.parameters(), strict=True))


def test_schema_partition_totals(reference):
    entries = tensor_manifest(reference.config)
    assert {role: sum(t["numel"] for t in entries if t["owner"] == role) for role in ROLE_COUNTS} == ROLE_COUNTS
    assert entries[-1]["canonical_offset_bytes"] + entries[-1]["byte_length"] == 44_163_072


def test_config_is_exact_and_hash_is_stable():
    config = load_config()
    assert config == ModelConfig()
    assert config.sha256 == ModelConfig().sha256
    with pytest.raises(ValueError, match="exact miniMol"):
        ModelConfig(vocab_size=257).validate()
    with pytest.raises(ValueError, match="exact miniMol"):
        ModelConfig(vocab_size=256.0).validate()


def test_byte_and_position_embedding_lookup(reference):
    ids = torch.tensor([[0, 255, 128, 65]], dtype=torch.int64)
    embedded = reference.embed(ids)
    for position, byte in enumerate(ids[0]):
        assert torch.equal(embedded[0, position], reference.token_embedding.weight[byte] + reference.position_embedding.weight[position])


@torch.inference_mode()
def test_causal_prefix_cannot_observe_future(reference):
    first = torch.tensor([[65, 66, 67, 68, 69]], dtype=torch.int64)
    second = torch.tensor([[65, 66, 250, 0, 255]], dtype=torch.int64)
    a, hidden_a = reference.forward_with_boundary(first)
    b, hidden_b = reference.forward_with_boundary(second)
    assert torch.equal(a[:, :2], b[:, :2])
    assert torch.equal(hidden_a[:, :2], hidden_b[:, :2])
    torch.testing.assert_close(a[:, :2], reference(first[:, :2]), atol=1e-5, rtol=1e-5)


@torch.inference_mode()
def test_attention_matches_independent_per_head_formula(reference):
    attention = reference.blocks[0].attn
    x = torch.linspace(-3, 3, 4 * 384).reshape(1, 4, 384)
    q, k, v = attention.qkv(x).chunk(3, dim=-1)
    heads = []
    for head in range(6):
        sl = slice(head * 64, (head + 1) * 64)
        positions = []
        for position in range(4):
            scores = (k[0, :position + 1, sl] * q[0, position, sl]).sum(-1) / 8
            probabilities = torch.softmax(scores, dim=-1)
            positions.append((probabilities[:, None] * v[0, :position + 1, sl]).sum(0))
        heads.append(torch.stack(positions))
    expected = F.linear(torch.cat(heads, dim=-1).unsqueeze(0), attention.proj.weight, attention.proj.bias)
    torch.testing.assert_close(attention(x), expected, atol=2e-6, rtol=2e-6)


def test_layer_norm_population_variance_and_epsilon(reference):
    x = torch.linspace(-2, 3, 768).reshape(2, 384)
    layer = reference.blocks[0].ln1
    mean = x.mean(-1, keepdim=True)
    variance = ((x - mean) ** 2).mean(-1, keepdim=True)
    expected = (x - mean) / torch.sqrt(variance + 1e-5) * layer.weight + layer.bias
    torch.testing.assert_close(layer(x), expected, atol=2e-6, rtol=2e-6)
    assert torch.isfinite(layer(torch.ones_like(x))).all()


def test_exact_gelu_and_mlp(reference):
    x = torch.linspace(-4, 4, 768).reshape(2, 384)
    mlp = reference.blocks[0].mlp
    projected = F.linear(x, mlp.fc1.weight, mlp.fc1.bias)
    exact = 0.5 * projected * (1 + torch.erf(projected / math.sqrt(2)))
    expected = F.linear(exact, mlp.fc2.weight, mlp.fc2.bias)
    torch.testing.assert_close(mlp(x), expected, atol=2e-6, rtol=2e-6)
    # This range separates the exact formula from the prohibited tanh approximation.
    approximate = mlp.fc2(F.gelu(projected, approximate="tanh"))
    assert (mlp(x) - approximate).abs().max() > 1e-5


@pytest.mark.parametrize("ids", [
    torch.tensor([], dtype=torch.int64).reshape(1, 0),
    torch.empty((0, 3), dtype=torch.int64),
    torch.zeros((1, 513), dtype=torch.int64),
    torch.tensor([1], dtype=torch.int64),
    torch.tensor([[256]], dtype=torch.int64),
    torch.tensor([[-1]], dtype=torch.int64),
    torch.tensor([[1.0]], dtype=torch.float32),
])
def test_invalid_input_rejected(reference, ids):
    with pytest.raises(ValueError):
        reference(ids)


@torch.inference_mode()
def test_maximum_context_is_finite(reference):
    ids = torch.tensor([list(range(256)) * 2], dtype=torch.int64)
    logits, hidden = reference.forward_with_boundary(ids)
    assert logits.shape == (1, 512, 256) and hidden.shape == (1, 512, 384)
    assert torch.isfinite(logits).all() and torch.isfinite(hidden).all()
    assert len(generate_reference(reference, bytes(range(256)) * 2, 5)) == 1


@pytest.mark.parametrize("text", ["Hello", "नमस्ते 🌍", "é", "\x00"])
def test_utf8_prompt_is_encoded_as_bytes(reference, text):
    encoded = text.encode("utf-8")
    ids = torch.tensor([list(encoded)], dtype=torch.int64)
    assert ids.numel() == len(encoded)
    with torch.inference_mode():
        logits = reference(ids)
    assert logits.shape == (1, len(encoded), 256)


def test_greedy_lowest_id_and_nonfinite_rejection():
    logits = torch.zeros(2, 256)
    logits[1, [17, 98]] = 4
    assert greedy_next_byte(logits).tolist() == [0, 17]
    logits[0, 0] = float("nan")
    with pytest.raises(ValueError):
        greedy_next_byte(logits)


def test_generation_determinism_and_input_policy(reference):
    assert generate_reference(reference, b"Hi", 4) == generate_reference(reference, b"Hi", 4)
    assert generate_reference(reference, b"Hi", 0) == []
    for prompt, count in [(b"", 1), (b"a" * 513, 1), ("Hi", 1), (b"Hi", -1), (b"Hi", 1.5)]:
        with pytest.raises(ValueError):
            generate_reference(reference, prompt, count)
