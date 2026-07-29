# Runtime evidence

Exact-client QA evidence is deliberately excluded from the public source snapshot because it may contain machine-specific paths, process metadata, or UI captures.

The runtime fails closed when this evidence is absent: affected adapters remain in `generic-safe` or `blocked` mode instead of receiving exact capabilities. Maintainers should generate and review fresh evidence on an isolated test account before promoting a new client build.
