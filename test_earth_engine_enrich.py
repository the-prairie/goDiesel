import importlib
import sys
from types import ModuleType, SimpleNamespace

import pytest


@pytest.fixture
def earth_engine_module(monkeypatch):
    fake_ee = ModuleType("ee")
    fake_ee.Algorithms = SimpleNamespace()
    fake_ee.Image = None
    fake_ee.Reducer = SimpleNamespace(median=None)
    monkeypatch.setitem(sys.modules, "ee", fake_ee)
    monkeypatch.setitem(sys.modules, "requests", ModuleType("requests"))

    module_name = "scripts.route_intelligence.earth_engine_enrich"
    monkeypatch.delitem(sys.modules, module_name, raising=False)
    module = importlib.import_module(module_name)
    yield module
    sys.modules.pop(module_name, None)


class FakeSize:
    def gt(self, value):
        return ("greater-than", value)


class FakeImage:
    def __init__(self, source):
        self.source = source
        self.renamed = None

    def rename(self, bands):
        self.renamed = bands
        return self


class FakeCollection:
    def __init__(self, name):
        self.name = name
        self.limits = []
        self.reductions = []
        self.sorts = []

    def size(self):
        return FakeSize()

    def sort(self, property_name):
        self.sorts.append(property_name)
        return self

    def limit(self, count):
        self.limits.append(count)
        return self

    def reduce(self, reducer, parallel_scale):
        image = FakeImage(self.name)
        self.reductions.append((reducer, parallel_scale, image))
        return image


def test_scene_composites_bound_earth_engine_memory_and_preserve_bands(
    monkeypatch,
    earth_engine_module,
):
    primary = FakeCollection("primary")
    fallback = FakeCollection("fallback")
    median = object()
    monkeypatch.setattr(earth_engine_module.ee.Reducer, "median", lambda: median)
    monkeypatch.setattr(
        earth_engine_module.ee.Algorithms,
        "If",
        lambda condition, primary_image, fallback_image: primary_image,
        raising=False,
    )
    monkeypatch.setattr(earth_engine_module.ee, "Image", lambda image: image)

    composite = earth_engine_module.composite_or_fallback(primary, fallback)

    assert primary.reductions[0][:2] == (median, 4)
    assert fallback.reductions[0][:2] == (median, 4)
    assert primary.sorts == ["CLOUDY_PIXEL_PERCENTAGE"]
    assert fallback.sorts == ["CLOUDY_PIXEL_PERCENTAGE"]
    assert primary.limits == [12]
    assert fallback.limits == [12]
    assert primary.reductions[0][2].renamed == ["B4", "B3", "B2"]
    assert fallback.reductions[0][2].renamed == ["B4", "B3", "B2"]
    assert composite.source == "primary"
