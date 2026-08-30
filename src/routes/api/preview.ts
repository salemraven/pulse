import { createFileRoute } from "@tanstack/react-router";

function isAllowedHost(hostname: string): boolean {
  return hostname === "audio-ssl.itunes.apple.com" || hostname === "audio.itunes.apple.com" || hostname.endsWith(".itunes.apple.com");
}

export const Route = createFileRoute("/api/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const src = new URL(request.url).searchParams.get("src");
        if (!src) return new Response("Missing src", { status: 400 });
        let parsed: URL;
        try {
          parsed = new URL(src);
        } catch {
          return new Response("Invalid src", { status: 400 });
        }
        if (parsed.protocol !== "https:" || !isAllowedHost(parsed.hostname)) {
          return new Response("Forbidden", { status: 403 });
        }
        const upstream = await fetch(parsed, { headers: { accept: "audio/*,*/*" } });
        if (!upstream.ok || !upstream.body) {
          return new Response("Preview unavailable", { status: 502 });
        }
        const headers = new Headers();
        headers.set("content-type", upstream.headers.get("content-type") ?? "audio/mpeg");
        headers.set("cache-control", "public, max-age=86400");
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
