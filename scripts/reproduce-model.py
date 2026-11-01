"""Regenerate in temporary storage; never overwrite project weights or goldens."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def run(*args):
    subprocess.run([sys.executable, '-B', *args], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)

def main():
    run('-m', 'model.verify_weights')  # Refuse regeneration audit if existing bytes are invalid.
    original = [ROOT/'artifacts/model/weights.bin', ROOT/'public/model/phone1.bin', ROOT/'public/model/phone2.bin', ROOT/'tests/fixtures/golden_vectors.json']
    before = {str(p.relative_to(ROOT)): digest(p) for p in original}
    with tempfile.TemporaryDirectory(prefix='minimol-reproduce-') as name:
        tmp = Path(name)
        run('-m', 'model.generate_weights', '--canonical-dir', str(tmp/'canonical'), '--public-dir', str(tmp/'public'), '--golden-path', str(tmp/'golden.json'))
        generated = [tmp/'canonical/weights.bin', tmp/'public/phone1.bin', tmp/'public/phone2.bin', tmp/'golden.json']
        matches = {str(old.relative_to(ROOT)): digest(old) == digest(new) for old,new in zip(original, generated)}
        if not all(matches.values()):
            raise RuntimeError(f'Deterministic regeneration mismatch: {matches}')
        # Environment metadata is intentionally descriptive; compare actual model contract separately.
        source = json.loads((ROOT/'public/model/manifest.json').read_text())
        fresh = json.loads((tmp/'public/manifest.json').read_text())
        assert {k:v for k,v in source.items() if k != 'generation'} == {k:v for k,v in fresh.items() if k != 'generation'}
    assert before == {str(p.relative_to(ROOT)): digest(p) for p in original}
    report = {'status':'PASS','seed':42,'originalsUnchanged':True,'byteIdentical':matches,'sha256':before,'scope':'pinned Python/PyTorch/NumPy environment; descriptive generator metadata may vary by host'}
    (ROOT/'artifacts/reports').mkdir(parents=True,exist_ok=True)
    (ROOT/'artifacts/reports/milestone7-reproducibility.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__ == '__main__':
    main()
