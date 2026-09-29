import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PenPaper — infinite whiteboard",
    short_name: "PenPaper",
    description:
      "An infinite canvas for sketches, diagrams, and notes. Draw with a pen, a finger, or a mouse.",
    // Opening the installed app lands on the shelf, where every notepad lives.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#6965db",
    lang: "en",
    dir: "ltr",
    categories: ["productivity", "graphics", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The mark is full-bleed and lives inside the 80% safe circle, so the
      // same pixels work as a maskable icon on Android.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
