# Synthetic fixtures (spec-derived)

These files are **not** recorded from real Liara. They are shaped after `specs/paas.yaml` schemas so
modules can be tested before T0.5 records real (redacted) fixtures in `fixtures/liara/`.

- Values are fake (`app-…`, ids, dates). No secrets.
- Unknown enum-like values use explicit placeholders (e.g. `status: "SYNTHETIC_STATUS"`) — see OQ-7.
- When T0.5 lands, tests should prefer the recorded fixture; keep these only where no real one exists.
