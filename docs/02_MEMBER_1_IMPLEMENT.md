# MEMBER 1 — BEGIN IMPLEMENTATION NOW (Python / ML)

You are the sole owner of `ml/`, `shared/model-spec.json` and the generated model assets in `web/public/model/`. Others will depend directly on the files/formats you export. Do not modify JavaScript, WebRTC or UI code.

## Exact first tasks in order
1. Read `README.md`, `docs/01_FROZEN_CONTRACT.md`, official `p2p.md`. Study `ml/model.py` line by line and confirm model count matches 11,040,768. The reference model is a documented provisional interpretation. Request the official model/seed-42 weight oracle from organizers. Do **not** misrepresent this as confirmed canonical.
2. Run `pip install -r ml/requirements.txt`; then `PYTHONPATH=ml pytest -q ml/test_reference.py`.
3. Run `python ml/export_weights.py`; verify full file length 44,163,072 bytes, phone1 22,473,216, phone2 21,689,856. Preserve the PyTorch version, initializer description and SHA256 in `manifest.json`.
4. Independently test all tensor shapes/names, first/full/second-half offsets, and that the shards concatenate in `named_parameters()` order to the full binary `weights.bin` (do not assume without a test).
5. Build stronger golden fixtures: prompt lengths 1, 2, 5, 32, 511, 512; UTF-8/non-ASCII; multiple generation steps; final 256 logits and 384 cut activations at several positions. Confirm exact greedy byte IDs.
6. Have Member 2 run `cd web && npm run parity` against your artifacts; debug numerical mismatches with one particular layer/operation before any mobile testing.
7. Test that a malformed or missing shard is detected by the browser engine rather than silently using random weights.

## Python implementation contract
`create_seeded_model()` returns float32 eval CPU transformer. `forward(tokens, return_cut=True)` returns full 256-dimensional logits per position plus cut tensor after blocks 0–2. `ml/export_weights.py` writes `manifest.json`, `phone1.bin`, `phone2.bin`, `fixtures.json`, and full `weights.bin` for reference. Do not change tensor names without agreement.

## Your pull request must include
`model.py`, `export_weights.py`, `test_reference.py`, expanded tests and a digest/parameter-count verification note. Commit code and small fixtures; coordinate binary distribution separately rather than accidentally committing ~44 MB directly to Git history.

## Paste this into your own coding LLM
"Act as the ML reference implementation owner for my Minimol P2P repo. Read README.md and docs/01_FROZEN_CONTRACT.md before editing. Review existing ml/model.py and ml/export_weights.py, run/expand deterministic PyTorch tests, check all 11,040,768 parameters, and generate row-major FP32 shards + golden vectors. Modify ONLY ml/** and, after team approval, shared/model-spec.json. Do not alter JS or protocol and do not replace the provisional model with a guess about an unpublished official reference. Output exact changed files, commands run, results, known gaps, and the verified SHA256. Start implementing, not lecturing."
