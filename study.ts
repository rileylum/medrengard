// What a study is: configurations, problems and repeats, fixed before it runs, and the problem sets
// they are drawn from. driver/study.ts runs one.

/**
 * A study: every configuration on every problem, `repeats` times each. The first configuration is
 * the control the others are compared with. `factory` is the path of the factory holding the
 * configurations, relative to the study file. Held-out problems run only in a study marked
 * `final`. A study with `calibrate` also runs SlopCodeBench's own harness at that effort, as the
 * configuration `slopcodebench`, for its `repeats` or the study's. How many problem runs go at once
 * is not the study's: it is chosen per invocation of the driver.
 */
export type Study = {
  factory: string;
  configurations: readonly string[];
  problems: readonly string[];
  repeats: number;
  final?: boolean;
  calibrate?: { effort: string; repeats?: number };
};

/** Declares a study, so the compiler checks its fields. */
export function defineStudy(study: Study): Study {
  return study;
}

/**
 * How a survey study's results choose the iteration set (driver/select.ts): the current problems,
 * each placed by one run of another study, kept, and the grid's cells filled to `perCell` by seed.
 */
export type Selection = {
  current: { problems: readonly string[]; study: string; run: string };
  perCell: number;
  seed: number;
};

/** Declares a selection, so the compiler checks its fields. */
export function defineSelection(selection: Selection): Selection {
  return selection;
}

// Drawn on 2026-11-05 before any of them ran in a study: for each difficulty, the sorted names
// sampled 4 with Python 3.14's random.Random(20261105), the first two to iterate on, the next two
// held out. code_search ran once before the draw, under the baseline only.

/** The problems configurations are compared and improved on. */
export const iteration = ["datagate", "textdrop", "file_query_tool", "mvvault", "meshctl", "eve_industry"];

/** The problems neither set holds: surveyed by the baseline once, to choose more to iterate on. */
export const unused = [
  "cfgpipe",
  "circuit_eval",
  "dag_execution",
  "database_migration",
  "dynamic_buffer",
  "env_manager",
  "etl_pipeline",
  "eve_jump_planner",
  "eve_market_tools",
  "eve_route_planner",
  "execution_server",
  "file_backup",
  "file_merger",
  "forge",
  "l2m",
  "layered_config_synthesizer",
  "log_query",
  "migrate_configs",
  "mocked_http",
  "pwd_manager",
  "rejector",
  "sheeteval",
  "sith",
  "test_translator",
];

/** The problems kept for a final claim, run only in a study marked final. */
export const heldOut = [
  "xjq",
  "code_search",
  "dynamic_config_service_api",
  "trajectory_api",
  "recli",
  "metric_transform_lang",
];
