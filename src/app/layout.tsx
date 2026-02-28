import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WARMON // Israel-Iran Conflict Dashboard",
  description:
    "Near-real-time conflict monitoring dashboard for the Israel–Iran war",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
      </head>
      <body className="bg-war-bg text-war-text font-mono antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}
