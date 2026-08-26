# Portable World Pack archive format

## Container

A portable World Pack uses a ZIP64 container with the suffix `.worldpack.zip`.
Every sealed pack file appears once at the archive root under its portable logical path.
Directories are implicit and no directory entries are emitted.

Every entry is stored without compression.
Entries are ordered lexicographically by UTF-8 path, use the fixed DOS timestamp `1980-01-01 00:00:00`, carry Unix regular-file mode `0444`, and contain no comment or encryption metadata.
The archive itself is not the pack identity.
The verified `manifest.json` pack ID remains the identity before and after export, copying, and import.
The archive receives a separate SHA-256 receipt for transport integrity.

Stored entries are deliberate.
They make export byte-deterministic across machines, avoid decompressor variation, and prevent a compressed archive from hiding an expansion ratio that the importer did not admit.
The source and open-format spikes may later justify a versioned compression profile, but v1 import rejects it rather than silently accepting non-canonical archives.

## Export gate

Export first performs full pack verification.
It refuses an existing destination rather than overwriting a possibly unique archive.
Two exports of the same sealed pack must be byte-identical and have the same archive SHA-256.

## Import gate

Import treats the archive as hostile input.
Before extraction it rejects:

- absolute paths, parent traversal, backslashes, empty segments, and null bytes;
- duplicate paths;
- directory, symbolic-link, encrypted, or compressed entries;
- an entry count above 20,000;
- a file above 8 GiB;
- declared extracted content above 64 GiB;
- an archive without `manifest.json` and `checksums.json`.

Extraction streams into a repository-owned staging directory and verifies the number of bytes written for every entry.
The importer then performs the same schema, pack-identity, checksum, lineage, required-runtime, external-reference, and source-inventory checks used for an installed pack.
Only a verified staging directory can be atomically promoted.

An existing directory with the same pack ID must have the exact same checksum inventory.
A conflict is rejected and never overwritten.
The canonical current-version pointer changes only after successful verification, promotion, and sealing.
