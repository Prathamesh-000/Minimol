"""Provisional model. Not judge-canonical unless organizers confirm implementation.

Exact dimensions/count as challenge; explicit pre-LN with tanh GELU.
IMPORTANT: altering construction order changes seed-42 weights.
"""
import torch
from torch import nn
from torch.nn import functional as F

VOCAB = 256
CONTEXT = 512
D = 384
HEADS = 6
HEAD_DIM = D // HEADS
FF = 1536
LAYERS = 6
EXPECTED_PARAMS = 11_040_768


class TransformerBlock(nn.Module):
    def __init__(self):
        super().__init__()
        self.ln1 = nn.LayerNorm(D, eps=1e-5)
        self.qkv = nn.Linear(D, 3 * D, bias=True)
        self.proj = nn.Linear(D, D, bias=True)
        self.ln2 = nn.LayerNorm(D, eps=1e-5)
        self.fc1 = nn.Linear(D, FF, bias=True)
        self.fc2 = nn.Linear(FF, D, bias=True)

    def forward(self, x):
        b, t, d = x.shape
        y = self.ln1(x)
        q, k, v = self.qkv(y).chunk(3, dim=-1)
        q = q.view(b, t, HEADS, HEAD_DIM).transpose(1, 2)
        k = k.view(b, t, HEADS, HEAD_DIM).transpose(1, 2)
        v = v.view(b, t, HEADS, HEAD_DIM).transpose(1, 2)
        scores = (q @ k.transpose(-2, -1)) * (HEAD_DIM ** -0.5)
        causal = torch.ones(t, t, dtype=torch.bool, device=x.device).triu(1)
        scores = scores.masked_fill(causal, float("-inf"))
        probs = scores.softmax(dim=-1)
        attention = (probs @ v).transpose(1, 2).contiguous().view(b, t, d)
        x = x + self.proj(attention)
        x = x + self.fc2(F.gelu(self.fc1(self.ln2(x)), approximate="tanh"))
        return x


class ByteTransformer(nn.Module):
    def __init__(self):
        super().__init__()
        # Creation order is part of our provisional canonical weight definition.
        self.token_embedding = nn.Embedding(VOCAB, D)
        self.position_embedding = nn.Embedding(CONTEXT, D)
        self.blocks = nn.ModuleList([TransformerBlock() for _ in range(LAYERS)])
        self.ln_f = nn.LayerNorm(D, eps=1e-5)
        self.head = nn.Linear(D, VOCAB, bias=False)  # Untied.

    def forward(self, tokens, return_cut=False):
        if tokens.dtype != torch.long or tokens.ndim != 2:
            raise ValueError("tokens must be int64 [batch, sequence]")
        t = tokens.shape[1]
        if not 1 <= t <= CONTEXT:
            raise ValueError("sequence must be 1..512 bytes")
        pos = torch.arange(t, device=tokens.device)
        x = self.token_embedding(tokens) + self.position_embedding(pos)[None, :, :]
        for i, block in enumerate(self.blocks):
            x = block(x)
            if i == 2:
                cut = x.clone()
        logits = self.head(self.ln_f(x))
        return (logits, cut) if return_cut else logits


def create_seeded_model():
    torch.manual_seed(42)
    model = ByteTransformer().cpu().float().eval()
    actual = sum(p.numel() for p in model.parameters())
    assert actual == EXPECTED_PARAMS, (actual, EXPECTED_PARAMS)
    return model
