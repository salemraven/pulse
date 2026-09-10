export type LibraryTrack = {
  id: string;
  title: string;
  artist: string;
  url: string;
};

function asset(path: string) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export const LIBRARY: LibraryTrack[] = [
  {
    id: "loss-of-purity",
    title: "Loss of Purity",
    artist: "ravenbloodrain",
    url: asset("/tracks/loss-of-purity.mp3"),
  },
  {
    id: "midnight-ballroom",
    title: "Midnight Ballroom",
    artist: "ravenbloodrain",
    url: asset("/tracks/midnight-ballroom.mp3"),
  },
  {
    id: "midnight-blade",
    title: "Midnight Blade",
    artist: "ravenbloodrain",
    url: asset("/tracks/midnight-blade.mp3"),
  },
  {
    id: "night-folk-2",
    title: "Night Folk 2",
    artist: "ravenbloodrain",
    url: asset("/tracks/night-folk-2.mp3"),
  },
];
