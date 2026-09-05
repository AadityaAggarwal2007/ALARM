"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", icon: "☀" },
  { href: "/overview", label: "Overview", icon: "▦" },
  { href: "/templates", label: "Repeats", icon: "⟳" },
  { href: "/analytics", label: "Analytics", icon: "◔" },
];

export default function NavBar() {
  const pathname = usePathname();

  // The login screen is the one place without navigation.
  if (pathname === "/login") return null;

  return (
    <nav className="tabbar">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
