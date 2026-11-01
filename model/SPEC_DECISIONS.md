# Model decisions

The authoritative implementation decisions are in [../SPEC_DECISIONS.md](../SPEC_DECISIONS.md).
Keep a single source of truth for initialization, tensor order, serialization,
numeric tolerances, byte handling, context limits, and outstanding risks.

`model_config.json` and `weight_format.py` are the machine-checkable architecture
and tensor contracts. `reference_model.py` is the canonical CPU FP32 forward path.
These are development-only tools; full-model execution is never allowed on a phone.
