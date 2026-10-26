// Public repository metadata only. No token, user data, or model calls.
const REPOSITORY = "https://github.com/pauljump/usual";
const TTL = 60 * 60 * 1000;
let saved: { stars: number; at: number } | undefined;
let pending: Promise<Response> | undefined;

function response(stars: number, stale = false): Response {
  return Response.json({ repository: REPOSITORY, stars, stale }, {
    headers: { "cache-control": `public, max-age=${stale ? 60 : 3600}` },
  });
}

export async function githubStars(): Promise<Response> {
  if (saved && Date.now() - saved.at < TTL) return response(saved.stars);
  if (pending) return (await pending).clone();
  pending = (async () => {
    try {
      const result = await fetch("https://api.github.com/repos/pauljump/usual", {
        headers: { "accept": "application/vnd.github+json", "user-agent": "Usual-ThoughtSwarm" },
        signal: AbortSignal.timeout(4000),
      });
      if (!result.ok) throw new Error("Repository metadata unavailable");
      const data = await result.json() as { stargazers_count?: unknown };
      if (!Number.isSafeInteger(data.stargazers_count) || (data.stargazers_count as number) < 0) throw new Error("Invalid star count");
      saved = { stars: data.stargazers_count as number, at: Date.now() };
      return response(saved.stars);
    } catch {
      return saved ? response(saved.stars, true) : Response.json({ repository: REPOSITORY, stars: null }, {
        status: 503, headers: { "cache-control": "no-store" },
      });
    }
  })();
  try { return (await pending).clone(); } finally { pending = undefined; }
}
