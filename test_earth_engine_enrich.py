from scripts.route_intelligence import earth_engine_enrich


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


def test_scene_composites_bound_earth_engine_memory_and_preserve_bands(monkeypatch):
    primary = FakeCollection("primary")
    fallback = FakeCollection("fallback")
    median = object()
    monkeypatch.setattr(earth_engine_enrich.ee.Reducer, "median", lambda: median)
    monkeypatch.setattr(
        earth_engine_enrich.ee.Algorithms,
        "If",
        lambda condition, primary_image, fallback_image: primary_image,
        raising=False,
    )
    monkeypatch.setattr(earth_engine_enrich.ee, "Image", lambda image: image)

    composite = earth_engine_enrich.composite_or_fallback(primary, fallback)

    assert primary.reductions[0][:2] == (median, 4)
    assert fallback.reductions[0][:2] == (median, 4)
    assert primary.sorts == ["CLOUDY_PIXEL_PERCENTAGE"]
    assert fallback.sorts == ["CLOUDY_PIXEL_PERCENTAGE"]
    assert primary.limits == [12]
    assert fallback.limits == [12]
    assert primary.reductions[0][2].renamed == ["B4", "B3", "B2"]
    assert fallback.reductions[0][2].renamed == ["B4", "B3", "B2"]
    assert composite.source == "primary"
