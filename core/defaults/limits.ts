import type { Limits } from "../src/replay.ts";

const mebibyte = 1024 * 1024;
const gibibyte = 1024 * mebibyte;

/**
 * Limits for a factory's `defaults`, to use as they are or to spread and change: ten minutes idle,
 * an hour per attempt, a 32 MiB transcript, 4 MiB of inputs, 4 GiB of memory, 1024 processes
 * and 4 GiB of disk.
 */
export const limits: Limits = {
  idle: 600,
  attempt: 3600,
  transcript: 32 * mebibyte,
  input: 4 * mebibyte,
  memory: 4 * gibibyte,
  processes: 1024,
  disk: 4 * gibibyte,
};
