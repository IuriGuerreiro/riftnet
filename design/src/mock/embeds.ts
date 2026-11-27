export type Embed =
  | {
      kind: "video";
      url: string;
      site: string;
      color: string;
      title: string;
      author: string;
      thumb: string;
      video: string;
    }
  | {
      kind: "link";
      url: string;
      site: string;
      color: string;
      title: string;
      description: string;
      image?: string;
      large?: boolean;
    };

const EMBEDS: Embed[] = [
  {
    kind: "video",
    url: "https://www.youtube.com/watch?v=adept-dash",
    site: "YouTube",
    color: "#ff0033",
    title: "Ridgeline: every dash cancel you should know (patch 0.9)",
    author: "DriftLab",
    thumb: "/media/photo-1.jpg",
    video: "/media/friday.mp4",
  },
  {
    kind: "link",
    url: "https://store.steampowered.com/app/4242/Hollow_Drift/",
    site: "Steam",
    color: "#66c0f4",
    title: "Ridgeline on Steam",
    description: "Fast, weird, co-op racing through drowned cities. −40% until Sunday.",
    image: "/media/photo-3.jpg",
    large: true,
  },
  {
    kind: "link",
    url: "https://adept.example/night-owls",
    site: "Adept",
    color: "#7c6cf2",
    title: "Late Shift · server rules",
    description: "Be kind, no spoilers outside #spoilers, clips go in #clips.",
    image: "/adept.svg",
  },
];

export function embedFor(url: string): Embed | undefined {
  return EMBEDS.find((e) => e.url === url);
}
