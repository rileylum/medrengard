// Event sequences for SC-01 to SC-19, mirroring tests/lifecycle.test.ts. Shared by tests that
// must replay every scenario through another path (e.g. the event store) and compare.
import type { Event, Stage } from '../src/lifecycle.ts';

const PASS_CHECKS = [{ name: 'tests', result: 'PASS' as const }];

const toStandardReview: Event[] = [
  { type: 'claim', runId: 'dev1', base: 'B1' },
  { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['result.json'] },
  { type: 'verification', head: 'H1', checks: PASS_CHECKS },
];

const bothPass: Event[] = [
  ...toStandardReview,
  { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
  { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'PASS' },
];

export interface Scenario {
  name: string;
  events: Event[];
  stage: Stage;
}

export const scenarios: Scenario[] = [
  { name: 'SC-01', stage: 'ACCEPTED', events: [...bothPass, { type: 'accept', head: 'H1' }] },
  {
    name: 'SC-02',
    stage: 'AWAITING_ACCEPTANCE',
    events: [
      ...toStandardReview,
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'FAIL', findings: ['f1'] },
      { type: 'claim', runId: 'dev2', base: 'B1' },
      { type: 'developer_result', runId: 'dev2', head: 'H2', artifacts: ['result.json'] },
      { type: 'verification', head: 'H2', checks: PASS_CHECKS },
      { type: 'verdict', runId: 'sr2', head: 'H2', verdict: 'PASS' },
      { type: 'verdict', runId: 'ar1', head: 'H2', verdict: 'PASS' },
    ],
  },
  {
    name: 'SC-03',
    stage: 'ESCALATED',
    events: [
      ...toStandardReview,
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'FAIL' },
      { type: 'claim', runId: 'dev2', base: 'B1' },
      { type: 'developer_result', runId: 'dev2', head: 'H2', artifacts: ['r'] },
      { type: 'verification', head: 'H2', checks: PASS_CHECKS },
      { type: 'verdict', runId: 'sr2', head: 'H2', verdict: 'FAIL' },
      { type: 'verdict', runId: 'sr3', head: 'H2', verdict: 'PASS' },
    ],
  },
  {
    name: 'SC-04',
    stage: 'ESCALATED',
    events: [
      ...toStandardReview,
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
      { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'FAIL' },
    ],
  },
  {
    name: 'SC-05',
    stage: 'ESCALATED',
    events: [
      ...toStandardReview,
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
      { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'FAIL' },
      { type: 'claim', runId: 'dev2', base: 'B1' },
    ],
  },
  {
    name: 'SC-06',
    stage: 'ADVERSARIAL_REVIEW',
    events: [
      ...toStandardReview,
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    ],
  },
  {
    name: 'SC-07',
    stage: 'ESCALATED',
    events: [
      { type: 'claim', runId: 'dev1', base: 'B1' },
      { type: 'developer_result', runId: 'dev1', artifacts: [] },
      { type: 'claim', runId: 'dev2', base: 'B1' },
    ],
  },
  {
    name: 'SC-08',
    stage: 'ESCALATED',
    events: [
      { type: 'claim', runId: 'dev1', base: 'B1' },
      { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
      { type: 'verification', head: 'H2', checks: PASS_CHECKS },
    ],
  },
  {
    name: 'SC-11',
    stage: 'ESCALATED',
    events: [
      { type: 'claim', runId: 'dev1', base: 'B1' },
      { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
      { type: 'verification', head: 'H1', checks: [{ name: 'security', result: 'FAIL' }] },
      { type: 'verdict', runId: 'stranger', head: 'H1', verdict: 'PASS' },
    ],
  },
  { name: 'SC-13', stage: 'ESCALATED', events: [{ type: 'reject_dispatch', reason: 'forbidden runtime' }] },
  {
    name: 'SC-16',
    stage: 'ESCALATED',
    events: [...toStandardReview, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' }, { type: 'head_changed', head: 'H2' }],
  },
  {
    name: 'SC-17',
    stage: 'ESCALATED',
    events: [
      ...toStandardReview,
      { type: 'base_changed', base: 'B2' },
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
      { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    ],
  },
  {
    name: 'SC-17b',
    stage: 'ESCALATED',
    events: [
      ...toStandardReview,
      { type: 'verdict', runId: 'sr1', head: 'H0', verdict: 'PASS' },
      { type: 'verdict', runId: 'sr1', head: 'H0', verdict: 'PASS' },
    ],
  },
  {
    name: 'SC-18',
    stage: 'ESCALATED',
    events: [...bothPass, { type: 'head_changed', head: 'H2' }, { type: 'accept', head: 'H2' }],
  },
  {
    name: 'SC-19',
    stage: 'ACCEPTED',
    events: [...bothPass, { type: 'accept', head: 'H1' }, { type: 'base_changed', base: 'B2' }],
  },
];
