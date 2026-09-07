# Deterministic workflows

Use deterministic workflow/script machinery when the topology/gates are computation that
should not be reinvented by a model each run. Keep dynamic reasoning at the places that
actually require judgment.

Before fan-out, discover the real work-list and compute shared mutable surfaces. Use
barriers only for genuine set-wide dependencies. Bound fix/retry loops and give failures
an upward escalation path rather than infinite self-correction.