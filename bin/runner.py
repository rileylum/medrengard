"""The runner seam's real side: SlopCodeBench's own code, at the commit pins.json names.

  runner.py problem <name>                         its checkpoints, assets and rendered prompts
  runner.py grade <snapshot> <name> <n> <out>      eval-snapshot's report for checkpoint n, with
                                                   scb-check's scores (verbosity, erosion) as quality

Prompts are rendered and snapshots graded by their CLI, and a snapshot keeps only the files their
own harness's snapshot keeps, so what is graded matches what their runs grade.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from slop_code.evaluation import ProblemConfig
from slop_code.execution.assets import resolve_static_assets
from slop_code.entrypoints.config.loader import resolve_environment
from slop_code.execution.snapshot import _walk_candidates
from slop_code.metrics.checkpoint.driver import _get_scb_check_metrics

RUNNER = Path(__file__).resolve().parent.parent / "vendor" / "slop-code-bench"
ENVIRONMENT = RUNNER / "configs" / "environments" / "docker-python3.12-uv.yaml"
PROMPT = "just-solve"


def problem_config(name):
    return ProblemConfig.from_yaml(Path(os.environ["SCBENCH_PROBLEMS_PATH"]) / name)


def assets(config):
    return resolve_static_assets(base_path=config.path, assets=config.static_assets)


def slop_code(*args):
    return subprocess.run(
        ["slop-code", "-q", *args], cwd=RUNNER, check=True, capture_output=True, text=True
    ).stdout


def problem(name):
    config = problem_config(name)
    count = len(list(config.iterate_checkpoints()))
    with tempfile.TemporaryDirectory() as rendered:
        slop_code("utils", "render-prompts", "-p", PROMPT, "-e", str(ENVIRONMENT), "-o", rendered, "--problem", name)
        prompts = [Path(rendered, f"part_{n}.md").read_text(encoding="utf-8") for n in range(1, count + 1)]
    return {
        "checkpoints": count,
        "assets": [
            {"source": str(asset.absolute_path), "path": asset.save_path.as_posix()}
            for asset in assets(config).values()
        ],
        "prompts": prompts,
    }


def grade(snapshot, name, n, out):
    snapshot = Path(snapshot)
    spec = resolve_environment(ENVIRONMENT)
    kept, _ = _walk_candidates(
        snapshot, spec.get_ignore_globs(assets(problem_config(name))), spec.snapshot.keep_globs
    )
    with tempfile.TemporaryDirectory() as checkpoint:
        # Their scb-check call scores <checkpoint>/snapshot, at the version their runner pins.
        graded = Path(checkpoint) / "snapshot"
        for path in kept:
            (graded / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(snapshot / path, graded / path)
        shutil.rmtree(out, ignore_errors=True)
        report = json.loads(
            slop_code("eval-snapshot", str(graded), "-o", out, "-p", name, "-c", n, "-e", str(ENVIRONMENT), "--json")
        )
        report["quality"] = _get_scb_check_metrics(Path(checkpoint))
        return report


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    print(json.dumps({"problem": problem, "grade": grade}[command](*args)))
