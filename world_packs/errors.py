"""World Pack failures with stable command-line meanings."""


class WorldPackError(Exception):
    """Base class for an expected World Pack failure."""


class ValidationError(WorldPackError):
    """A document or input does not satisfy the World Pack contract."""


class IntegrityError(WorldPackError):
    """Retained content does not match its declared identity."""


class AcquisitionError(WorldPackError):
    """A source adapter cannot acquire admissible evidence."""


class MigrationError(WorldPackError):
    """A pack cannot be read or migrated by the installed framework."""
