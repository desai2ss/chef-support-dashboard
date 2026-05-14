import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chef Support Dashboard",
  description: "Day-to-day production monitoring across Pylon, Datadog, BigQuery, and team-entered data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream text-ink">{children}</body>
    </html>
  );
}
