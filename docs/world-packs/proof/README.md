# World Pack Proofs

`traversal-proof.json` is the checked result of the production physics workload invoked by `npm run prove:world-packs:traversal` from `app`.
The command loads the active sealed packs, repeats every retained navigation edge three times at no more than 2 m sample spacing, and simulates 600 seconds of fixed-timestep free roam in each world.
It fails on route grounding error above 1 cm, undeclared jumps, structure intersections, missing endpoints, excessive step transitions, ten seconds of persistent blocking, or failure to leave the guided corridor.
The committed trace hashes make a changed physical result visible even when aggregate counts still pass.
