import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chef Support Dashboard",
  description: "Day-to-day production monitoring across Pylon, Datadog, BigQuery, and team-entered data.",
};

// Inline pre-hydration script that sets the .dark class on <html> before
// React renders, so we don't flash light theme for users on dark.
const initTheme = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: initTheme }} />
      </head>
      <body className="min-h-screen bg-cream text-ink">{children}</body>
    </html>
  );
}
