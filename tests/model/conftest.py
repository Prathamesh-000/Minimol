import pytest

from model.export_weights import export_reference
from model.reference_model import build_reference


@pytest.fixture(scope="session")
def reference():
    return build_reference()


@pytest.fixture(scope="session")
def exported_bundle(reference, tmp_path_factory):
    root = tmp_path_factory.mktemp("model-bundle")
    canonical, public = root / "canonical", root / "public"
    manifest = export_reference(reference, canonical, public)
    return canonical, public, manifest
