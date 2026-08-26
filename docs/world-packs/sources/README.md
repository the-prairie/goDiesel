# World source receipts

These canonical receipts bind retainable public source objects to exact local custody bytes.
The large source objects live under ignored `world-packs-local/sources`; the receipt, adapter, licence evidence checksum, immutable object version, byte size, and SHA-256 are the committed acquisition contract.

Validate the Ucluelet custody set with:

```sh
.venv/bin/python -m scripts.verify_world_source_receipt \
  docs/world-packs/sources/ucluelet-lidarbc-2019.json \
  world-packs-local/sources/ucluelet/2019
```

Receipt admission fails closed when retention, derivatives, or redistribution are not allowed, when the legal decision is not `admit`, when a filename escapes custody, or when any retained byte differs.
The receipt does not claim full exploration-envelope coverage; the compiler must still run an exact coverage-union gate before promotion.
