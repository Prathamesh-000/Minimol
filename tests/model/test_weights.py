import copy
import hashlib
import json
from pathlib import Path
import shutil
import struct

import numpy as np
import pytest
import torch

from model.config import ROOT
from model.export_weights import export_reference, repartition, write_json
from model.load_weights import load_reference_role
from model.reference_model import build_reference
from model.verify_weights import VerificationError, validate_manifest, verify_bundle, verify_role
from model.weight_format import ROLE_COUNTS


def test_bundle_sizes_hashes_shapes_and_exact_reconstruction(exported_bundle):
    canonical, public, manifest = exported_bundle
    report = verify_bundle(canonical, public)
    assert report["parameter_count"] == 11_040_768
    assert report["tensor_count"] == 77
    assert report["all_weights_finite_fp32"] and report["exact_reconstruction"]
    assert (canonical / "weights.bin").stat().st_size == 44_163_072
    assert (public / "phone1.bin").stat().st_size == 22_473_216
    assert (public / "phone2.bin").stat().st_size == 21_689_856
    full = (canonical / "weights.bin").read_bytes()
    assert full == (public / "phone1.bin").read_bytes() + (public / "phone2.bin").read_bytes()
    for role, directory in [("full", canonical), ("phone1", public), ("phone2", public)]:
        data = (directory / manifest["files"][role]["name"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == manifest["files"][role]["sha256"]
    for tensor in manifest["tensors"]:
        array = np.frombuffer(full, dtype="<f4", count=tensor["numel"], offset=tensor["canonical_offset_bytes"])
        assert array.reshape(tensor["shape"]).size == tensor["numel"]


def test_serialization_is_little_endian_row_major_and_lossless(reference, exported_bundle):
    canonical, _, manifest = exported_bundle
    full = (canonical / "weights.bin").read_bytes()
    state = reference.state_dict()
    for entry in manifest["tensors"]:
        array = np.frombuffer(full, dtype="<f4", count=entry["numel"], offset=entry["canonical_offset_bytes"])
        assert np.array_equal(array.reshape(entry["shape"]), state[entry["name"]].numpy())
    first_value = float(reference.token_embedding.weight[0, 0].detach())
    assert full[:4] == struct.pack("<f", first_value)


def test_repeated_export_is_byte_identical(exported_bundle, tmp_path):
    canonical, public, first_manifest = exported_bundle
    again_canonical, again_public = tmp_path / "canonical", tmp_path / "public"
    second_manifest = export_reference(build_reference(), again_canonical, again_public)
    assert first_manifest == second_manifest
    for name, a, b in [("weights.bin", canonical, again_canonical), ("manifest.json", canonical, again_canonical),
                       ("phone1.bin", public, again_public), ("phone2.bin", public, again_public),
                       ("manifest.json", public, again_public)]:
        assert (a / name).read_bytes() == (b / name).read_bytes()


def test_standalone_repartition_matches_original(exported_bundle, tmp_path):
    canonical, public, _ = exported_bundle
    repartition(canonical, tmp_path / "public")
    for name in ["manifest.json", "phone1.bin", "phone2.bin"]:
        assert (public / name).read_bytes() == (tmp_path / "public" / name).read_bytes()


def test_public_manifest_never_exposes_full_asset(exported_bundle):
    _, public, _ = exported_bundle
    manifest = json.loads((public / "manifest.json").read_text())
    assert set(manifest["files"]) == {"phone1", "phone2"}
    assert "weights.bin" not in (public / "manifest.json").read_text()
    assert not (public / "weights.bin").exists()
    assert not verify_bundle(None, public)["exact_reconstruction"]


@pytest.mark.parametrize("field,value", [
    ("shape", [384, 256]), ("owner", "phone2"), ("offset_bytes", 4),
    ("canonical_offset_bytes", 4), ("dtype", "float16"), ("numel", 1),
    ("offset_bytes", 0.0), ("offset_bytes", False),
])
def test_manifest_schema_tampering_rejected(exported_bundle, field, value):
    _, _, original = exported_bundle
    manifest = copy.deepcopy(original)
    manifest["tensors"][0][field] = value
    with pytest.raises(VerificationError, match="tensors"):
        validate_manifest(manifest, include_full=True)


@pytest.mark.parametrize("mutation", ["order", "missing", "extra", "file_path", "config_hash", "wrong_seed"])
def test_manifest_structure_tampering_rejected(exported_bundle, mutation):
    _, _, original = exported_bundle
    manifest = copy.deepcopy(original)
    if mutation == "order":
        manifest["tensors"][0], manifest["tensors"][1] = manifest["tensors"][1], manifest["tensors"][0]
    elif mutation == "missing":
        manifest["tensors"].pop()
    elif mutation == "extra":
        manifest["tensors"].append(manifest["tensors"][0])
    elif mutation == "file_path":
        manifest["files"]["phone1"]["name"] = "../../weights.bin"
    elif mutation == "config_hash":
        manifest["config_sha256"] = "0" * 64
    else:
        manifest["generation"]["seed"] = 43
    with pytest.raises(VerificationError):
        validate_manifest(manifest, include_full=True)


@pytest.mark.parametrize("role", ["phone1", "phone2"])
@pytest.mark.parametrize("corruption", ["flip", "truncate", "nan", "infinity"])
def test_corrupt_shard_rejected_even_if_nonfinite_hash_is_updated(exported_bundle, tmp_path, role, corruption):
    _, public, _ = exported_bundle
    manifest = json.loads((public / "manifest.json").read_text())
    data = bytearray((public / f"{role}.bin").read_bytes())
    if corruption == "flip":
        data[0] ^= 1
        expected_error = "SHA-256"
    elif corruption == "truncate":
        del data[-4:]
        expected_error = "size"
    else:
        data[:4] = struct.pack("<f", float("nan") if corruption == "nan" else float("inf"))
        manifest["files"][role]["sha256"] = hashlib.sha256(data).hexdigest()
        expected_error = "Nonfinite"
    (tmp_path / f"{role}.bin").write_bytes(data)
    write_json(tmp_path / "manifest.json", manifest)
    with pytest.raises(VerificationError, match=expected_error):
        verify_role(tmp_path, role)


def test_reconstruction_detects_consistent_but_changed_shard_hashes(exported_bundle, tmp_path):
    canonical, public, _ = exported_bundle
    own_canonical, own_public = tmp_path / "canonical", tmp_path / "public"
    shutil.copytree(canonical, own_canonical)
    shutil.copytree(public, own_public)
    data = bytearray((own_public / "phone1.bin").read_bytes())
    data[:4] = struct.pack("<f", 0.125)
    (own_public / "phone1.bin").write_bytes(data)
    for directory in [own_canonical, own_public]:
        manifest = json.loads((directory / "manifest.json").read_text())
        manifest["files"]["phone1"]["sha256"] = hashlib.sha256(data).hexdigest()
        write_json(directory / "manifest.json", manifest)
    with pytest.raises(VerificationError, match="reconstruct"):
        verify_bundle(own_canonical, own_public)


@torch.inference_mode()
def test_isolated_role_loads_own_only_shard_and_matches_full_reference(reference, exported_bundle, tmp_path):
    _, public, _ = exported_bundle
    roles = {}
    for role in ROLE_COUNTS:
        directory = tmp_path / role
        directory.mkdir()
        shutil.copyfile(public / "manifest.json", directory / "manifest.json")
        shutil.copyfile(public / f"{role}.bin", directory / f"{role}.bin")
        # Opposite shard and full weights physically do not exist in this directory.
        module = load_reference_role(directory, role)
        assert sum(p.numel() for p in module.parameters()) == ROLE_COUNTS[role]
        roles[role] = module
    a_names, b_names = set(roles["phone1"].state_dict()), set(roles["phone2"].state_dict())
    assert a_names.isdisjoint(b_names)
    assert a_names | b_names == set(reference.state_dict())
    assert set(roles["phone1"].blocks) == {"0", "1", "2"}
    assert set(roles["phone2"].blocks) == {"3", "4", "5"}
    for prompt in [b"Hello", "नमस्ते 🌍".encode("utf-8"), bytes([0, 255, 128]), bytes(range(256)) * 2]:
        ids = torch.tensor([list(prompt)], dtype=torch.int64)
        logits, boundary = reference.forward_with_boundary(ids)
        actual_boundary = roles["phone1"](ids)
        actual_logits = roles["phone2"](actual_boundary)
        # On this same CPU path the split should be exact, stronger than the
        # cross-engine tolerance that later milestones must satisfy.
        assert torch.equal(actual_boundary, boundary)
        assert torch.equal(actual_logits, logits)


def test_invalid_role_is_rejected(exported_bundle):
    _, public, _ = exported_bundle
    with pytest.raises(VerificationError, match="Role"):
        load_reference_role(public, "full")


def test_full_weights_cannot_be_exported_under_public(reference, tmp_path):
    with pytest.raises(ValueError, match="outside public"):
        export_reference(reference, ROOT / "public/forbidden", tmp_path)
    with pytest.raises(ValueError, match="outside public"):
        export_reference(reference, tmp_path / "public/nested", tmp_path / "public")


@pytest.mark.parametrize("shape,dtype,nonfinite", [
    ((1, 384), torch.float32, False), ((1, 1, 383), torch.float32, False),
    ((1, 0, 384), torch.float32, False), ((1, 513, 384), torch.float32, False),
    ((1, 1, 384), torch.float64, False), ((1, 1, 384), torch.float32, True),
])
def test_phone2_rejects_invalid_boundary_tensors(exported_bundle, shape, dtype, nonfinite):
    _, public, _ = exported_bundle
    role = load_reference_role(public, "phone2")
    activation = torch.zeros(shape, dtype=dtype)
    if nonfinite:
        activation[0, 0, 0] = float("inf")
    with pytest.raises(ValueError, match="finite CPU float32"):
        role(activation)
