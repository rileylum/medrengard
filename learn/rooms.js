// The rooms of the guide in reading order: the map (index.html) and every room's bar read this.
export const ROOMS = [
  { file: 'start.html', title: 'The big idea', blurb: 'What the factory is for, the rules every workflow keeps, and who does what, in one picture.' },
  { file: 'sim.html', title: 'The simulator', blurb: 'Write a ticket, pick a workflow, play the agents, and watch the factory\'s own controller take it to a PR.', big: true },
  { file: 'lifecycle.html', title: 'Workflows', blurb: 'Stages are data: agent, command and human. Edit a workflow and watch the real checkWorkflow judge it.' },
  { file: 'store.html', title: 'The event log', blurb: 'Nothing is overwritten. Query a recorded run as events prints it, and try to break the log.' },
  { file: 'controller.html', title: 'Controller and owner', blurb: 'Agents claim; the controller decides. Feed it a hostile adapter, and see what accept and cancel record.' },
  { file: 'developer.html', title: 'The developer', blurb: 'The prompt and its versions, the guard on a claim, the fix run, and the dispute.' },
  { file: 'verify.html', title: 'Checks and command stages', blurb: 'The controller runs every command itself, on a fresh checkout. Build a command stage and see what would run.' },
  { file: 'review.html', title: 'Reviews', blurb: 'Fresh eyes with nothing but the evidence. Every path through the budget, and a diff too big to send.' },
  { file: 'sandbox.html', title: 'Sandbox and secrets', blurb: 'Candidate code is untrusted. Build a bubblewrap policy, and follow a grant to the one place it may go.' },
  { file: 'runtimes.html', title: 'Runtimes and kits', blurb: 'A CLI becomes an adapter by name. How a claim is found in a reply, and the kits an extension must pass.' },
  { file: 'config.html', title: 'Configuration', blurb: 'Four layers: defaults, yours, the repository\'s and the job\'s. Merge them, and see what a repository may not set.' },
  { file: 'process.html', title: 'How this repo is built', blurb: 'Plan rows, tickets, reviews and decisions, run by hand. Read live from docs/.' },
  { file: 'architecture.html', title: 'The map of the code', blurb: 'Every module in src/, who imports whom, and the seams the design turns on.' },
];
