/**
 * Small transport-agnostic helpers left in the plugin after the request layer
 * moved to @dualtran/core.
 *
 * The plugin runs inside Logseq's sandboxed iframe, so every AI call is a plain
 * `fetch` from a page origin — CORS decides whether a provider works. Failures
 * therefore have to say "blocked by CORS", not "network error", or users chase
 * the wrong fix.
 */

/**
 * Long blocks blow past provider limits and make one bad sentence poison the
 * whole block. Split on paragraph boundaries first, then hard-wrap anything
 * still oversized.
 */
export function chunkText(text: string, limit = 1800): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const parts: string[] = [];
  let current = "";
  for (const paragraph of clean.split(/\n{2,}/)) {
    if ((current + "\n\n" + paragraph).trim().length <= limit) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) parts.push(current);
    if (paragraph.length <= limit) {
      current = paragraph;
    } else {
      for (let i = 0; i < paragraph.length; i += limit) parts.push(paragraph.slice(i, i + limit));
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function describeFetchFailure(error: unknown, url?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    const target = url ? ` ${url}` : " the provider";
    return (
      `Could not reach${target}. Two common causes: the endpoint is unreachable, or the ` +
      `provider does not allow browser requests (CORS). Open Logseq's developer console: a CORS ` +
      `rejection is reported there, and only a server-side change or a different provider fixes it.`
    );
  }
  return message;
}
