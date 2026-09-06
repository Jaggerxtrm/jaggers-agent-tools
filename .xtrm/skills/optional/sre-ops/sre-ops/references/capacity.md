# Capacity and host pressure

Capacity investigation is evidence-first. Measure the filesystem/device and resource pool
that the workload actually uses; root filesystem free space is not evidence that `/tmp`,
a tmpfs, container volume, runner workspace, database volume, or build cache is healthy.

Inspect as relevant:

- host and container CPU saturation;
- available vs total memory and swap/pressure;
- disk usage/inodes on the actual mount;
- tmpfs/RAM-backed scratch usage;
- process/container top consumers;
- runner/build concurrency;
- database/cache growth;
- orphaned worktrees/build artifacts/processes.

Prefer reclaiming known disposable state and reducing unnecessary concurrency before
adding capacity. Do not delete caches/worktrees/containers merely because they are large;
prove ownership and safe reclaimability first.

For recurring pressure, create a durable remediation contract covering prevention,
limits/alerts, and verification after cleanup.