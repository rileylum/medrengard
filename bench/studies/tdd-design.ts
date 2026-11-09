// obra/superpowers' test-driven-development and Matt Pocock's codebase-design, each against a fresh baseline
// run alongside, paired by problem, as review-verify did (V6): n=3 on `screen`. Not yet run: the owner holds
// it until later in the week to keep the subscription's weekly use.
// Paid: only with the owner's approval.
import { defineStudy, screen } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline", "test-driven-development", "codebase-design"],
  problems: screen,
  repeats: 3,
});
