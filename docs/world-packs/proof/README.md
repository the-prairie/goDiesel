# World Pack Proofs

`traversal-proof.json` is the checked result of the production physics workload invoked by `npm run prove:world-packs:traversal` from `app`.
The command loads the active sealed packs, repeats every retained navigation edge three times at no more than 2 m sample spacing, and simulates 600 seconds of fixed-timestep free roam in each world.
It fails on route grounding error above 1 cm, undeclared jumps, structure intersections, missing endpoints, excessive step transitions, ten seconds of persistent blocking, or failure to leave the guided corridor.
The committed trace hashes make a changed physical result visible even when aggregate counts still pass.

`durability-proof.json` is the checked result of `.venv/bin/python -m scripts.prove_world_pack_durability`.
The command removes provider credentials, blocks socket connections, exports each pack twice, imports it into a temporary clean repository, verifies current and previous pack identities as schema-v1 no-ops, tampers with terrain collision, repairs from the imported content inventory, and verifies the original identity again.
No sealed pre-v1 pack exists, so real schema N-1 migration remains unproven.

`film-proof.json` is the checked result of `npm run prove:world-packs:films` from `app` while the local preview is available at port 8796.
The command removes provider credentials, blocks provider requests, recomputes every delivered MP4 and poster checksum, inspects H.264/AAC streams and dimensions, and renders five timeline positions twice in fresh pages.
It fails unless the two passes are pixel-exact, visibly nonblank, and bound to the active pack and cinematic timeline identities.

`owner-mac-performance.json` is captured by `GODIESEL_CAPTURE_WORLD_PACK_PERFORMANCE=1 npm run perf:world-packs` from `app`.
The production-build workload blocks non-local requests, measures startup and frame intervals in every reference world, counts connected WebGL contexts, and compares garbage-collected heap settlement after a warmup plus three complete three-world entry and exit cycles.
The first meaningful mark is emitted only after the provider-free Canvas preview has drawn the local route geometry; physical readiness remains a separate sealed-pack and collision-world measurement.
