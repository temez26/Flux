import type { Metadata, Viewport } from "next";
import { themeScript } from "@/components/settings/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flux",
  description: "Fast, simple file transfer for your home network.",
  applicationName: "Flux",
  // "default" is a white bar in every theme; "black" suits dark mode and stays readable in light.
  appleWebApp: { capable: true, title: "Flux", statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets data-theme before hydration, which React would otherwise flag.
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
