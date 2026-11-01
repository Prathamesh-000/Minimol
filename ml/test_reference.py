import torch
from model import create_seeded_model, EXPECTED_PARAMS


def test_shapes_count_and_causal_mask():
    model = create_seeded_model()
    assert sum(p.numel() for p in model.parameters()) == EXPECTED_PARAMS
    with torch.no_grad():
        logits, cut = model(torch.tensor([[65, 66, 67]], dtype=torch.long), return_cut=True)
        shorter = model(torch.tensor([[65, 66]], dtype=torch.long))
    assert logits.shape == (1, 3, 256)
    assert cut.shape == (1, 3, 384)
    assert torch.allclose(logits[0, :2], shorter[0], atol=2e-4, rtol=1e-4)


def test_seed_repeatability():
    a, b = create_seeded_model(), create_seeded_model()
    assert torch.equal(next(a.parameters()), next(b.parameters()))
