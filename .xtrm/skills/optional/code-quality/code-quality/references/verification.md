# Verification before completion

Do not convert “implemented” into “done” without fresh evidence.

For each success criterion, identify the command, artifact, runtime state, or observable
behavior that proves it. Run the relevant checks after the final change. If a required
check cannot run, report that explicitly and explain the residual risk.

Watch for test theatre: a new test that also passes against the pre-fix behavior is not
proof of the claimed defect unless it validates some other explicit invariant.