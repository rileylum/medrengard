#!/bin/sh
# Runs bin/runner.py in the pinned SlopCodeBench runner's environment, on the pinned problems.
here=$(dirname "$(realpath "$0")")
# The pinned checkouts live in the benchmark's data directory, as data.ts finds it.
export MEDRENGARD_BENCH_DATA=${MEDRENGARD_BENCH_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/medrengard/bench}
export SCBENCH_PROBLEMS_PATH="$MEDRENGARD_BENCH_DATA/vendor/scb-problems"
# Grading runs through rootless Podman; the grader builds its base image through the Docker SDK.
export DOCKER_HOST="unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
exec uv run --quiet --project "$MEDRENGARD_BENCH_DATA/vendor/slop-code-bench" python "$here/runner.py" "$@"
