// Bring-your-own-key access to POST /market-analysis.
//
// A visitor without the ADMIN_TOKEN may run the market advisor with their OWN
// Anthropic API key, sent in the `x-anthropic-key` request header. The key is
// used for that single call and then dropped: it is never stored (no D1, no
// KV, no logs) and it never unlocks anything else -- every other admin action
// still requires ADMIN_TOKEN.

export const VISITOR_KEY_HEADER = "x-anthropic-key";

/** Anthropic API keys start with "sk-ant-"; reject anything else early. */
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

export function readVisitorKey(request: Request): string | null {
  const raw = request.headers.get(VISITOR_KEY_HEADER)?.trim() ?? "";
  return KEY_SHAPE.test(raw) ? raw : null;
}

/**
 * Light per-visitor rate limit (per Worker isolate, best effort): protects
 * the Worker's free-tier CPU and D1 reads from repeated visitor runs. The
 * visitor's Anthropic spend is on their own key either way.
 */
export const VISITOR_LIMIT = 3;
export const VISITOR_WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number[]>();

export function visitorAllowed(ip: string, now = Date.now()): boolean {
  const kept = (recent.get(ip) ?? []).filter((t) => now - t < VISITOR_WINDOW_MS);
  if (kept.length >= VISITOR_LIMIT) {
    recent.set(ip, kept);
    return false;
  }
  kept.push(now);
  recent.set(ip, kept);
  return true;
}

/** Test helper. */
export function resetVisitorLimits(): void {
  recent.clear();
}
