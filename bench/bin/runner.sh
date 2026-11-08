#!/bin/sh
# Runs bin/runner.py in the pinned SlopCodeBench runner's environment, on the pinned problems.
here=$(dirname "$(realpath "$0")")
export SCBENCH_PROBLEMS_PATH="$here/../vendor/scb-problems"
# Grading runs through rootless Podman; the grader builds its base image through the Docker SDK.
export DOCKER_HOST="unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
exec uv run --quiet --project "$here/../vendor/slop-code-bench" python "$here/runner.py" "$@"
