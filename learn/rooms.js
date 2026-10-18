// The rooms of the guide in reading order: the map (index.html) and every room's bar read this.
export const ROOMS = [
  { file: 'start.html', title: 'The big idea', blurb: 'What the factory is for, the five rules it never breaks, and an idea going all the way to a PR in one picture.' },
  { file: 'sim.html', title: 'The simulator', blurb: 'Write a ticket, play the agents, and watch the factory\'s own controller move it to a PR. Change any input; see what breaks.', big: true },
  { file: 'lifecycle.html', title: 'The state machine', blurb: 'Nine stages, one pure function. Drive it with events by hand and replay the scenarios from the tests.' },
  { file: 'store.html', title: 'The event log', blurb: 'Nothing is ever overwritten. Scrub through a cycle\'s history and see why a redelivered verdict changes nothing.' },
  { file: 'controller.html', title: 'Controller and adapters', blurb: 'Agents return claims; the controller decides. Feed the real controller a hostile adapter and watch it hold.' },
  { file: 'developer.html', title: 'The developer run', blurb: 'The prompt a developer gets, the claim it must return, and the guard that refuses a commit it cannot prove.' },
  { file: 'verify.html', title: 'Verification', blurb: 'The controller runs the checks itself, on a fresh checkout. PASS, FAIL and MISSING, and the tree check.' },
  { file: 'review.html', title: 'Reviews and the budget', blurb: 'Fresh eyes with nothing but the evidence. Two standard reviews, one adversarial, and what happens at the limit.' },
  { file: 'sandbox.html', title: 'The sandbox', blurb: 'Candidate code is untrusted. Build a bubblewrap policy and see the exact command the factory would run.' },
  { file: 'runtimes.html', title: 'Runtimes: claude and pi', blurb: 'How a CLI becomes an adapter, and how a claim is found at the end of a model\'s reply.' },
  { file: 'workflow.html', title: 'How the factory is built', blurb: 'Plan rows, tickets, two reviews and an adversary, by hand. The tickets and decisions, read live from docs/.' },
  { file: 'architecture.html', title: 'The map of the code', blurb: 'Every module in src/, who imports whom, and the three seams the design turns on.' },
];
