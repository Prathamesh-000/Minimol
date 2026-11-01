import json

import pytest
import torch

from model.config import ROOT
from model.golden_vectors import ATOL, RTOL, write_golden_vectors
from model.load_weights import load_reference_role
from model.reference_model import generate_reference, greedy_next_byte
from model.verify_weights import verify_bundle


@pytest.fixture(scope="module")
def golden():
    return json.loads((ROOT / "tests/fixtures/golden_vectors.json").read_text(encoding="utf-8"))


def test_checked_in_golden_binds_to_actual_assets(golden):
    report = verify_bundle(ROOT / "artifacts/model", ROOT / "public/model")
    assert golden["config_sha256"] == report["config_sha256"]
    assert golden["weight_sha256"] == {role: info["sha256"] for role, info in report["files"].items()}
    assert golden["tolerance"] == {"atol": ATOL, "rtol": RTOL, "greedy_ids_must_match": True}
    assert len(golden["cases"]) == 7


@torch.inference_mode()
def test_all_golden_activations_logits_greedy_and_generated_bytes(reference, golden):
    for case in golden["cases"]:
        prompt = bytes(case["prompt_bytes"])
        logits, hidden = reference.forward_with_boundary(torch.tensor([list(prompt)], dtype=torch.int64))
        for sample in case["samples"]:
            position = sample["position"]
            torch.testing.assert_close(hidden[0, position], torch.tensor(sample["phone1_activation"]), atol=ATOL, rtol=RTOL)
            torch.testing.assert_close(logits[0, position], torch.tensor(sample["logits"]), atol=ATOL, rtol=RTOL)
            assert int(greedy_next_byte(logits[0, position])) == sample["greedy_byte"]
        assert generate_reference(reference, prompt, case["max_new_bytes"]) == case["generated_bytes"]


@torch.inference_mode()
def test_golden_sequences_from_reloaded_shards(exported_bundle, golden):
    _, public, _ = exported_bundle
    phone1 = load_reference_role(public, "phone1")
    phone2 = load_reference_role(public, "phone2")
    for case in golden["cases"]:
        context = case["prompt_bytes"].copy()
        generated = []
        while len(generated) < case["max_new_bytes"] and len(context) <= 512:
            activation = phone1(torch.tensor([context], dtype=torch.int64))
            logits = phone2(activation)
            byte = int(greedy_next_byte(logits[0, -1]))
            generated.append(byte)
            context.append(byte)
        assert generated == case["generated_bytes"]


def test_golden_fixture_regeneration_is_byte_identical(reference, exported_bundle, tmp_path):
    _, _, manifest = exported_bundle
    output = tmp_path / "golden_vectors.json"
    write_golden_vectors(reference, manifest, output)
    assert output.read_bytes() == (ROOT / "tests/fixtures/golden_vectors.json").read_bytes()
