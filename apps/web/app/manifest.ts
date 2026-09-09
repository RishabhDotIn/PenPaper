import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PenPaper",
    short_name: "PenPaper",
    description: "An infinite canvas for sketches, diagrams, and notes.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#6965db",
  };
}
