import assert from "node:assert/strict";
import test from "node:test";
import { COLLAPSED_NOTCH_WIDTH, notchSummary, type NotchAgent } from "./notchSummary.ts";

function agent(status: string, extra: Partial<NotchAgent> = {}): NotchAgent {
  return { status, ...extra };
}

test("empty, one, and many agents stay a single rollup", () => {
  assert.equal(notchSummary([]).level, "empty");
  assert.equal(notchSummary([]).label, "Winsur · listening");

  const one = notchSummary([agent("idle")]);
  assert.equal(one.level, "idle");
  assert.equal(one.count, 1);
  assert.equal(one.label, "Winsur · 1 agent");

  const two = notchSummary([agent("idle"), agent("idle")]);
  assert.equal(two.label, "Winsur · 2 agents");
  assert.equal(two.count, 2);

  const many = notchSummary(Array.from({ length: 20 }, () => agent("idle")));
  assert.equal(many.level, "idle");
  assert.equal(many.count, 20);
  assert.equal(many.label, "Winsur · 20 agents");
  assert.equal(COLLAPSED_NOTCH_WIDTH, 248);
});

test("mixed states use error over waiting over working over idle", () => {
  const mixed = notchSummary([
    agent("idle"),
    agent("thinking"),
    agent("thinking"),
    agent("waiting"),
    agent("error"),
    agent("error"),
  ]);
  assert.equal(mixed.level, "error");
  assert.equal(mixed.count, 2);
  assert.equal(mixed.label, "Winsur · 2 errors");
  assert.equal(mixed.dot, "#f87171");

  const oneError = notchSummary([agent("error"), agent("thinking")]);
  assert.equal(oneError.label, "Winsur · 1 error");

  const waiting = notchSummary([
    agent("thinking"),
    agent("idle", { pending_question: "Which file?" }),
    agent("idle", { pending_plan: { title: "Plan" } }),
  ]);
  assert.equal(waiting.level, "waiting");
  assert.equal(waiting.count, 2);
  assert.equal(waiting.label, "Winsur · 2 waiting");
  assert.equal(waiting.dot, "#fbbf24");

  const working = notchSummary([agent("thinking"), agent("thinking"), agent("idle")]);
  assert.equal(working.level, "working");
  assert.equal(working.count, 2);
  assert.equal(working.label, "Winsur · 2 working");
  assert.equal(working.dot, "#60a5fa");
});

test("disconnected agents are ignored", () => {
  const summary = notchSummary([agent("disconnected"), agent("disconnected")]);
  assert.equal(summary.level, "empty");
});
