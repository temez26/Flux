import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flux",
    short_name: "Flux",
    description: "Fast, simple file transfer for your home network.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Lists Flux under Share in other apps once installed. Android and desktop Chrome honour it;
    // iOS offers web apps no way in.
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["*/*"] }] },
    },
    // The manifest allows one colour pair; installed apps use it for the splash screen and
    // system bars before the page's own theme-color (which follows light/dark) takes over.
    background_color: "#0c0c10",
    theme_color: "#0c0c10",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
