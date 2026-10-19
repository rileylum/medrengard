// Ticket 10-c: what a command stage's command is told about its run (A-074, A-081). The controller
// writes it to request.json in the stage's evidence directory and names that file in SF_REQUEST.

export interface CommandRequest {
  cycleId: string;
  workId: string;
  /** The command stage's name in the workflow. */
  stage: string;
  head: string;
  base: string;
  ticket: string;
  /** `git diff --text <base> <head>`, uncut: the checkout has no .git. */
  diffFile: string;
  /** Empty at the start; with the checkout, the only path the command can write. */
  outputDir: string;
}
