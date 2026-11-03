import assert from "node:assert/strict";
import test from "node:test";
import { preferSession } from "./agentMerge.ts";

test("an older snapshot cannot put an idle agent back on working", () => {
  const current = { status: "idle", last_event_at: "2026-11-03T12:00:02.000Z", name: "app" };
  const stale = { status: "thinking", last_event_at: "2026-11-03T12:00:01.000Z", name: "scan" };
  assert.equal(preferSession(current, stale), current);
});

test("a newer idle snapshot replaces working", () => {
  const current = { status: "thinking", last_event_at: "2026-11-03T12:00:01.000Z" };
  const next = { status: "idle", last_event_at: "2026-11-03T12:00:02.000Z" };
  assert.deepEqual(preferSession(current, next), next);
});

test("the first snapshot is kept", () => {
  const incoming = { status: "thinking", last_event_at: "2026-11-03T12:00:01.000Z" };
  assert.equal(preferSession(null, incoming), incoming);
});
