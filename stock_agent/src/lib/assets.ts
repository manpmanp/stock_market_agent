// Serves static assets out of an R2 bucket bound as ASSETS -- currently
// just the three Decision Lab demo videos (src/decisionLab.ts's
// Methodology -> Demos tab), but written generically (any key under the
// bucket) in case other static files need serving later. See README
// "Demo videos" for how to create the bucket and upload files.
//
// No auth gate: these are small, non-sensitive demo clips meant to be
// publicly viewable on the (already-public) dashboard, same trust level
// as /rankings or /decision-lab itself.

import type { Env } from "./types.js";

export async function serveAsset(env: Env, key: string): Promise<Response> {
  if (!env.ASSETS) {
    return new Response(
      JSON.stringify({ error: 'asset storage not configured -- see README "Demo videos"' }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }
  if (!key) {
    return new Response(JSON.stringify({ error: "missing asset key" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const object = await env.ASSETS.get(key);
  if (!object) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Demo videos are immutable in normal use -- a replacement only happens
  // when you intentionally re-upload one under the same key, and the
  // etag above still lets a conditional request pick that up -- so a long
  // cache lifetime is safe rather than re-fetching from R2 on every view.
  headers.set("cache-control", "public, max-age=604800");
  return new Response(object.body, { headers });
}
