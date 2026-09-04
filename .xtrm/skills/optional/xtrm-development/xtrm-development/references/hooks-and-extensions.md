# Hooks and extensions

Hooks/extensions are XTRM's deterministic enforcement/integration plane. Before adding a
new hook, check whether the active harness already exposes the lifecycle event or native
capability needed.

Keep hooks small, bounded, observable, and fail-open/fail-closed according to the actual
risk contract. Test event payloads and error/timeout behavior. Shared semantics across Pi
and Claude belong in shared contracts/helpers; runtime adapters should stay thin.