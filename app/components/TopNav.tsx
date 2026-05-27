"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; enabled: boolean }[] = [
  { href: "/", label: "Fleet", enabled: true },
  { href: "/tickets", label: "Tickets", enabled: true },
  { href: "/schedules", label: "Schedules", enabled: true },
  { href: "/sites", label: "Sites", enabled: false },
  { href: "/team", label: "Team", enabled: true },
];

export default function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 mb-5">
      {TABS.map((t) => {
        const active = pathname === t.href;
        const base =
          "px-3 py-1.5 rounded-md text-sm font-medium transition-colors";
        if (!t.enabled) {
          return (
            <span
              key={t.href}
              className={base + " text-muted cursor-not-allowed opacity-50"}
              title="Coming soon"
            >
              {t.label}
            </span>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              base +
              " " +
              (active
                ? "bg-white text-black"
                : "text-muted hover:text-white hover:bg-white/5")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
