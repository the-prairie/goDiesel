"""Validation and geometry for deterministic normalized terrain grids."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .canonical import strict_json_load
from .errors import ValidationError
from .geometry import build_glb
from .schema import validate_document


@dataclass(frozen=True)
class NormalizedTerrain:
    document: dict[str, object]
    minimum_x_m: float
    minimum_y_m: float
    step_m: float
    columns: int
    rows: int
    heights_m: tuple[float, ...]
    measured_runs: tuple[tuple[int, int], ...]

    @classmethod
    def load(cls, path: Path) -> "NormalizedTerrain":
        value = strict_json_load(path)
        if not isinstance(value, dict):
            raise ValidationError("normalized terrain is not an object")
        validate_document("normalized-terrain", value)
        grid = value["grid"]
        assert isinstance(grid, dict)
        columns = int(grid["columns"])
        rows = int(grid["rows"])
        raw_heights = grid["heightsM"]
        assert isinstance(raw_heights, list)
        if len(raw_heights) != columns * rows:
            raise ValidationError(
                "normalized terrain height count does not match the declared grid"
            )
        raw_runs = grid["measuredRuns"]
        assert isinstance(raw_runs, list)
        runs: list[tuple[int, int]] = []
        previous_end = 0
        for index, raw_run in enumerate(raw_runs):
            assert isinstance(raw_run, list)
            start, length = int(raw_run[0]), int(raw_run[1])
            if index > 0 and start < previous_end:
                raise ValidationError("normalized terrain measured runs overlap")
            if start + length > columns * rows:
                raise ValidationError(
                    "normalized terrain measured run exceeds the grid"
                )
            runs.append((start, length))
            previous_end = start + length
        nodata = value["nodata"]
        assert isinstance(nodata, dict)
        measured_count = sum(length for _, length in runs)
        if int(nodata["filledVertexCount"]) != columns * rows - measured_count:
            raise ValidationError(
                "normalized terrain filled vertex count is inconsistent"
            )
        return cls(
            document=value,
            minimum_x_m=float(grid["minimumXM"]),
            minimum_y_m=float(grid["minimumYM"]),
            step_m=float(grid["stepM"]),
            columns=columns,
            rows=rows,
            heights_m=tuple(float(value) for value in raw_heights),
            measured_runs=tuple(runs),
        )

    @property
    def measured_vertex_count(self) -> int:
        return sum(length for _, length in self.measured_runs)

    def is_measured(self, index: int) -> bool:
        if not 0 <= index < len(self.heights_m):
            raise IndexError(index)
        for start, length in self.measured_runs:
            if index < start:
                return False
            if index < start + length:
                return True
        return False

    def position(self, index: int) -> tuple[float, float, float]:
        if not 0 <= index < len(self.heights_m):
            raise IndexError(index)
        row, column = divmod(index, self.columns)
        return (
            self.minimum_x_m + column * self.step_m,
            self.minimum_y_m + row * self.step_m,
            self.heights_m[index],
        )

    def is_measured_at(self, x_m: float, y_m: float) -> bool:
        column = round((x_m - self.minimum_x_m) / self.step_m)
        row = round((y_m - self.minimum_y_m) / self.step_m)
        if not 0 <= column < self.columns or not 0 <= row < self.rows:
            return False
        return self.is_measured(row * self.columns + column)

    def positions(self) -> list[tuple[float, float, float]]:
        return [self.position(index) for index in range(len(self.heights_m))]

    def indices(self) -> list[int]:
        result: list[int] = []
        for row in range(self.rows - 1):
            for column in range(self.columns - 1):
                lower_left = row * self.columns + column
                upper_left = lower_left + self.columns
                result.extend(
                    [
                        lower_left,
                        lower_left + 1,
                        upper_left,
                        lower_left + 1,
                        upper_left + 1,
                        upper_left,
                    ]
                )
        return result

    def normals(self) -> list[tuple[float, float, float]]:
        result: list[tuple[float, float, float]] = []
        for row in range(self.rows):
            for column in range(self.columns):
                index = row * self.columns + column
                if not self.is_measured(index):
                    result.append((0.0, 0.0, 1.0))
                    continue
                left = row * self.columns + max(0, column - 1)
                right = row * self.columns + min(self.columns - 1, column + 1)
                lower = max(0, row - 1) * self.columns + column
                upper = min(self.rows - 1, row + 1) * self.columns + column
                x_distance = max(1, right % self.columns - left % self.columns) * self.step_m
                y_distance = max(1, upper // self.columns - lower // self.columns) * self.step_m
                dz_dx = (self.heights_m[right] - self.heights_m[left]) / x_distance
                dz_dy = (self.heights_m[upper] - self.heights_m[lower]) / y_distance
                magnitude = (dz_dx * dz_dx + dz_dy * dz_dy + 1.0) ** 0.5
                result.append((-dz_dx / magnitude, -dz_dy / magnitude, 1.0 / magnitude))
        return result

    def colors(self) -> list[tuple[float, float, float, float]]:
        measured_heights = [
            height
            for index, height in enumerate(self.heights_m)
            if self.is_measured(index)
        ]
        minimum = min(measured_heights)
        maximum = max(measured_heights)
        span = maximum - minimum or 1.0
        low = (0.13, 0.31, 0.18)
        high = (0.55, 0.57, 0.5)
        result: list[tuple[float, float, float, float]] = []
        for index, height in enumerate(self.heights_m):
            if not self.is_measured(index):
                result.append((0.05, 0.25, 0.39, 1.0))
                continue
            ratio = max(0.0, min(1.0, (height - minimum) / span))
            result.append(
                (
                    low[0] + (high[0] - low[0]) * ratio,
                    low[1] + (high[1] - low[1]) * ratio,
                    low[2] + (high[2] - low[2]) * ratio,
                    1.0,
                )
            )
        return result

    def visual_glb(self) -> bytes:
        return build_glb(
            self.positions(),
            indices=self.indices(),
            mode=4,
            name="Measured terrain with explicit no-data fill",
            normals=self.normals(),
            colors=self.colors(),
            material={
                "name": "Measured land and declared water",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.92,
                },
                "doubleSided": True,
            },
        )

    def collision_glb(self) -> bytes:
        return build_glb(
            self.positions(),
            indices=self.indices(),
            mode=4,
            name="Normalized terrain collision heightfield",
        )

    def mask_document(self) -> dict[str, object]:
        nodata = self.document["nodata"]
        assert isinstance(nodata, dict)
        document = {
            "schemaVersion": 1,
            "columns": self.columns,
            "rows": self.rows,
            "measuredRuns": [list(run) for run in self.measured_runs],
            "nodataSemantic": nodata["semantic"],
        }
        validate_document("terrain-mask", document)
        return document
