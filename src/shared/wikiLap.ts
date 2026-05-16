/** Your Wiki lap constants (survey → execute → cleanup). Tune in one place. */
export const WIKI_LAP_PLAN_CAP = 8
export const WIKI_EXECUTE_MAX_TOOL_CALLS = 60
export const WIKI_SURVEY_MAX_TOOL_CALLS = 40
/** Minimum net characters added (execute) or changed on disk vs pre-lap snapshot for a path to count as a meaningful edit. */
export const WIKI_LAP_MIN_MEANINGFUL_CHARS = 40
/** Saturation: skip re-proposing a path when indexed mail count grew by less than this since last meaningful edit. */
export const WIKI_SATURATION_MIN_INDEXED_DELTA = 50
