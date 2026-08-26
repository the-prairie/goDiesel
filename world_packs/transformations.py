"""Deterministic transformation-lineage graph."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .canonical import canonical_json_bytes, sha256_bytes
from .errors import ValidationError


@dataclass(frozen=True)
class TransformationStep:
    name: str
    version: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]
    configuration: dict[str, object]

    @property
    def identity(self) -> str:
        return sha256_bytes(canonical_json_bytes(asdict(self)))

    def as_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["inputs"] = list(self.inputs)
        value["outputs"] = list(self.outputs)
        value["identity"] = self.identity
        return value


class TransformationGraph:
    def __init__(self) -> None:
        self._steps: dict[str, TransformationStep] = {}
        self._output_owners: dict[str, set[str]] = {}

    def add(self, step: TransformationStep) -> str:
        if not step.name.strip() or not step.version.strip():
            raise ValidationError("transformation name and version must have content")
        if not step.outputs:
            raise ValidationError(f"transformation {step.name!r} has no outputs")
        identity = step.identity
        if identity in self._steps:
            raise ValidationError(f"duplicate transformation: {identity}")
        self._steps[identity] = step
        for output in step.outputs:
            self._output_owners.setdefault(output, set()).add(identity)
        try:
            self._assert_acyclic()
        except ValidationError:
            del self._steps[identity]
            for output in step.outputs:
                owners = self._output_owners[output]
                owners.remove(identity)
                if not owners:
                    del self._output_owners[output]
            raise
        return identity

    def as_document(self) -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "steps": [
                self._steps[identity].as_dict()
                for identity in sorted(self._steps)
            ],
        }

    def _assert_acyclic(self) -> None:
        dependencies: dict[str, set[str]] = {}
        for identity, step in self._steps.items():
            dependencies[identity] = {
                owner
                for input_digest in step.inputs
                for owner in self._output_owners.get(input_digest, set())
            }
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(identity: str) -> None:
            if identity in visiting:
                raise ValidationError("transformation graph contains a cycle")
            if identity in visited:
                return
            visiting.add(identity)
            for dependency in dependencies[identity]:
                visit(dependency)
            visiting.remove(identity)
            visited.add(identity)

        for identity in dependencies:
            visit(identity)
