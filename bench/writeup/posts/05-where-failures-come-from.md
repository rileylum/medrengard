# Testing published agent skills, part 5: where the failures come from

[Part 4](04-no-decay.md) found that the agent almost never breaks code it has already written. So
when a checkpoint fails, it fails the first time the agent writes the code. This post asks why,
and the answer turned out to be mostly about the benchmark rather than the agent.

## The same tests fail in every run

In the review and verify study, three configurations ran three times each: nine independent
attempts at every checkpoint, each starting from its own earlier code. If failures were the agent
making random mistakes, different runs would fail different tests. They don't:

- Of all 1,772 failed checkpoint tests in the study, 59% are tests that **all nine runs** fail.
- 81% are tests that at least seven of the nine fail.
- 117 distinct tests are failed by every run, whatever the configuration.

A review skill, a verification skill and the plain baseline make the same mistakes in the same
places. Something about those places is hard for this model, or something about them is wrong.

## What we checked

The tests that decide whether a checkpoint is solved are the **Core** tests. 39 of the 117 shared
failures are Core tests, and all 39 are on four problems: datagate, file_merger, eve_market_tools
and layered_config_synthesizer. We read every one, along with test_translator's collapse at
checkpoint 5 from part 4.

For each, we compared three things: what the spec says, what the test asserts (and what the
grader's assertion message shows), and what the agent's code does. Then we put each failure in one
of four bins:

- **Misreading**: the spec is clear and the agent did something else.
- **Ambiguity**: the spec allows more than one reasonable reading, and the tests pick one the agent
  didn't.
- **Spec gap**: the tests require something the spec never states.
- **Contradiction**: the spec says one thing and the tests require another.

The reading was split across separate review passes, each given the spec, tests, assertion messages
and code, but not our expectations. We then checked the key quotes in each ourselves.

## What we found

| problem | shared Core failures | cause |
|---|---|---|
| datagate | 3 | ambiguity |
| file_merger | 6 | spec gap, contradiction, ambiguity |
| eve_market_tools | 8 | spec gaps and contradictions |
| layered_config_synthesizer | 22 | mainly contradictions |
| test_translator (part 4) | collapse from checkpoint 5 | spec gap |

We didn't find one shared Core failure that we'd call a plain misreading of a clear spec. A few
also carry a slip of the agent's own, but in each case a spec problem fails the test first.

### datagate: an ambiguity, made worse by the tests

Checkpoint 2 adds a `rowid` to each row:

> `_shape=objects`: `rows` is objects and includes `rowid` (1-based source-file row number).

Is the first data row 1 (the first row, numbered from 1) or 2 (its line in the file, after the
header)? Every run chose 1. The tests want 2:

```python
assert [row["rowid"] for row in payload["rows"]] == [2, 3, 4, 5, 6]
```

That test's own docstring calls these "sequential 1-based rowid values". The literal phrase
"source-file row number" does favour the tests' reading, so it's not a pure coin flip. But it's a
genuinely ambiguous sentence. In a pilot run, code-review's Spec reviewer flagged exactly this
("file line 4, or data row 3 ... whichever numbering"), and the agent kept its reading. The same
off-by-one fails a spreadsheet test at checkpoint 4.

### file_merger: what the spec says and what the reference does

At checkpoint 2, files of different formats are merged, and the spec says typed sources win:

> `--schema-strategy=authoritative` (default): prefer typed sources in precedence order
>
> JSONL values come typed (string/number/bool/null)

Every run treated JSONL as typed, as the spec says, so a JSONL file's integers decided a column's
type, and a CSV file's `2.5` became null. The reference solution has only two tiers, Parquet and
"inferred", and lumps JSONL in with CSV. The tests follow the reference.

At checkpoint 4, the spec repeats checkpoint 1's CSV rules, "RFC-4180 … escape by doubling". The
test inputs escape quotes with backslashes instead (`"{\"a\":[1,2]}"`), with no flag saying so. The
reference solution reads the first 8 KB of each file and switches to backslash escapes if it sees
`\"`, a rule the spec never mentions. Every run followed the spec, mis-parsed those rows, and
failed four Core tests. The fifth is an ambiguity: whether a partition directory's column name is
percent-encoded like its value.

### eve_market_tools: units, types and rounding

The spec says `total_value` "is the sum of sell values using 5pct price". It gives other values in
billions but doesn't say so for this one; the tests want billions. Every run returned the raw
amount, 22,760,000,000 instead of 22.76.

At checkpoint 4, the spec types competition counts as `<int>`; the tests expect floats (`2.0`), and
the grader's comparison doesn't treat `2` and `2.0` as equal. The spec's own worked example says
that "to undercut an order of 12,000, we need to set it to 11,990"; the expected output doesn't
undercut. The spec says profit per unit is "sans tax"; the expected values are taxed. One part
does lean towards the agent being wrong: the spec says averages are over "the past 30 days", and
at least one run divided by the 29 days the data covered.

### layered_config_synthesizer: a contradiction in every checkpoint

Part 3 met this one: what goes in `warnings.txt` when there are no warnings.

| | says |
|---|---|
| checkpoint 1, line 80 | "create the file with a trailing newline and no text" |
| checkpoint 1, line 91 | "Empty file (zero bytes) is acceptable only if there are no warnings" |
| checkpoint 2, line 108 | "Leave the file empty (0 bytes) only if there are no warnings" |
| checkpoint 4, line 101 | "`warnings.txt` is empty if no conflicts occurred" |
| every test, every checkpoint | expects exactly one newline |

The tests compare files byte for byte. At checkpoint 2, all nine runs wrote zero bytes, as that
checkpoint's spec says, and in five of the nine it's the only thing wrong with their output.

Behind it sit smaller problems of the same kind:

- **Example vs rule.** checkpoint 1's worked example drops a default `profile` that the merge rules
  say to keep. Three runs followed the example; the tests follow the rules.
- **Arrays.** checkpoint 2 says a fragment "must be a JSON object or scalar". The tests expect an
  array fragment to work. The test case still ships a leftover file expecting the error the spec
  describes, so an earlier version of the test agreed with the spec.
- **A missing rule.** One test expects environment values to be expanded inside other environment
  values (`MESSAGE=deploy ${STAGE}`). The spec never says so.

This is why the problem's Core pass rate sits between 0.1 and 0.4 for every configuration. It's
not that this model can't build a layered config merger.

### test_translator: an unnamed file

Checkpoint 5 says any `.py` file under the tests directory holds tests, and that non-Python files
with test-like names, such as `test*.{ext}`, are an error. Each test case directory also holds a
`solution.py` and the program's own `tester.js` or `tester.ts`. No spec at any checkpoint mentions
either. The reference solution quietly skips both:

```python
if path.name == "solution.py":
    continue
if path.name in {"tester.py", "tester.js", "tester.ts", "tester.cpp", "tester.rs"}:
    continue
```

An agent following the spec treats `solution.py` as a test file and `tester.js` as an error, and
fails thousands of cases from checkpoint 5 to the end. The one baseline run that solved
checkpoint 5 happened to skip `solution.py`.

## What this means

**For the skills.** A reviewer can only hold code to the spec it's given. When the spec says one
thing and the tests another, a careful reviewer pulls the code *towards* the failure: in part 3,
layered_config_synthesizer's Spec reviewer approved the change that broke nine tests, quoting the
spec correctly. No same-model review, and no amount of verification, fixes a failure that's in the
spec.

**For the comparisons in this series.** These failures hit every configuration alike, so the
paired differences in part 2 stay fair. But they put a ceiling on "solved" that no configuration
can get past, and they make solved a coarser measure than it looks.

**For reading SlopCodeBench scores.** Part of a model's "solve rate" here measures agreement with
choices the reference solution made and the spec doesn't state. That's true of many benchmarks,
but in a long-horizon one it compounds: a gap at checkpoint 5 fails every checkpoint after it.
Scores on these problems mix the model's ability with how its readings happen to line up with the
reference's.

## Caveats

- **We read only the shared Core failures,** on four problems, plus test_translator. Shared
  failures in other test groups (meshctl, eve_jump_planner and others) weren't examined, and some of
  those may be real misreadings.
- **The bins are judgement calls,** especially ambiguity against gap. We've quoted the spec and
  tests for each so readers can judge for themselves.
- **Failures in only some runs** weren't examined here. Those are where the agent's own mistakes
  are more likely to be.

## The series in one paragraph

On SlopCodeBench, with Claude Opus 5.5 in Claude Code, Matt Pocock's `code-review` skill makes
code clearly cleaner at about twice the cost, and doesn't make it more correct. Most of the
cleanliness builds up across checkpoints rather than arriving in any one review. It can't show up
in the solve rate, because within eight checkpoints the agent almost never breaks what it built.
obra's `verification-before-completion` changes little. And the failures that remain are largely
not the agent's: they're places where the benchmark's specs are ambiguous, silent, or contradict
their own tests, which no review by the same model can catch.
