// Drop an IPC payload that is older than the card already on screen, so a late
// scan snapshot cannot put a finished agent back on "working".

export function eventMillis(iso: string | undefined): number {
  const parsed = Date.parse(iso ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function preferSession<T extends { status: string; last_event_at: string }>(
  current: T | null,
  incoming: T,
): T {
  if (!current) return incoming;
  if (eventMillis(incoming.last_event_at) < eventMillis(current.last_event_at)) {
    return current;
  }
  return incoming;
}
