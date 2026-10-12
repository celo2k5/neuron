import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Neuron", short_name: "Neuron",
    description: "Create neurons. Build networks. Run experiments. Watch computation become visible.",
    start_url: "/", display: "standalone", background_color: "#080B12", theme_color: "#080B12",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
