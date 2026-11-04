#!/bin/sh
# Runs SlopCodeBench's own harness on one problem's first <count> checkpoints, all if left out: the
# calibration for the baseline. Spends the owner's subscription: only with their approval.
#
#   calibration/run.sh <problem> <effort> [<count>]
#
# TOKEN_FILE names another token file, such as an invalid one to check the wiring at no cost.
#
# Their catalogs are read only from their checkout, so this adds Opus 5.5 and a provider whose
# credential reaches Claude Code as CLAUDE_CODE_OAUTH_TOKEN, the owner's subscription token. Their
# runner cannot stop after a checkpoint, so it runs on a copy of the problem with only the first <count>.
set -eu
here=$(dirname "$(realpath "$0")")
runner="$here/../vendor/slop-code-bench"
scratch=/var/tmp/medrengard/bench-calibration
problem=$1 effort=$2 count=${3:-0}

cp "$here/opus-5.5.yaml" "$runner/configs/models/opus-5.5.yaml"
grep -q '^  anthropic-subscription:' "$runner/configs/providers.yaml" || cat >> "$runner/configs/providers.yaml" <<'YAML'

  # Added by medrengard-bench: the owner's Claude subscription token.
  anthropic-subscription:
    type: env_var
    env_var: CLAUDE_CODE_OAUTH_TOKEN
    description: Claude subscription OAuth token
YAML

rm -rf "$scratch/problems/$problem"
mkdir -p "$scratch/problems" "$scratch/outputs"
cp -r "$here/../vendor/scb-problems/$problem" "$scratch/problems/$problem"
uv run --quiet --project "$runner" python -I - "$scratch/problems/$problem/config.yaml" "$count" <<'PY'
import sys, yaml
path, count = sys.argv[1], int(sys.argv[2])
config = yaml.safe_load(open(path))
if count:
    config["checkpoints"] = {f"checkpoint_{n}": config["checkpoints"][f"checkpoint_{n}"] for n in range(1, count + 1)}
yaml.safe_dump(config, open(path, "w"), sort_keys=False)
PY

cd "$runner"
CLAUDE_CODE_OAUTH_TOKEN=$(cat "${TOKEN_FILE:-$HOME/.config/medrengard/claude-token}") \
SCBENCH_PROBLEMS_PATH="$scratch/problems" \
  uv run slop-code run \
    --agent "$here/claude_code.yaml" \
    --model anthropic-subscription/opus-5.5 \
    --environment configs/environments/docker-python3.12-uv.yaml \
    --prompt configs/prompts/just-solve.jinja \
    --problem "$problem" \
    thinking="$effort" \
    save_dir="$scratch/outputs"
