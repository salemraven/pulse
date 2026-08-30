import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SearchHit } from "./types";

type ItunesSong = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
};

export const searchTracks = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ q: z.string().trim().min(1).max(80) }).parse(input))
  .handler(async ({ data }): Promise<SearchHit[]> => {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", data.q);
    url.searchParams.set("media", "music");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "12");
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("Search is unavailable right now.");
    const json = (await res.json()) as { results?: ItunesSong[] };
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const item of json.results ?? []) {
      if (!item.previewUrl || !item.trackName || !item.artistName) continue;
      const key = `${item.trackName.toLowerCase()}::${item.artistName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const artwork = (item.artworkUrl100 ?? "").replace("100x100bb", "300x300bb");
      hits.push({
        id: String(item.trackId ?? hits.length),
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName ?? "",
        artworkUrl: artwork,
        previewUrl: item.previewUrl,
      });
      if (hits.length >= 8) break;
    }
    return hits;
  });
