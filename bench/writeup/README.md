# The write-up

Posts on what the review and verify studies found, and the scripts that make their figures. Every
figure and number comes from the data directory by a script here, so the same data give the same
files. Free: nothing here runs a model.

- `record.ts`: a study's result lines, the trajectories repository, and `quality`, scb-check's
  whole report on any commit as grading scores it (`bin/runner.py quality`), cached under the data
  directory's `writeup/quality/`.
- `diffs.ts`: code-review's own diffs. Each of its checkpoints ends with the commit addressing the
  review, so the review's diff is that commit's parent to it. `measure` writes every review's
  scb-check before and after to `data/reviews.jsonl`; `show <commission>` prints one review's diff.
- `figures.ts`: the charts (`svg.ts`, no dependency) and `figures/tables.md`, from the studies'
  lines, `breakage` in `driver/report.ts` and `data/reviews.jsonl`.

```sh
node writeup/diffs.ts measure     # once, or after a study is added
node writeup/figures.ts
node writeup/diffs.ts show review-verify-code-review-r1-textdrop-2
```
