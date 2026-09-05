import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./planner.css";
import "./timeline.css";
import RingGuard from "@/components/RingGuard";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Discipline",
  description: "A schedule that holds you to it.",
  appleWebApp: {
    capable: true,
    title: "Discipline",
    statusBarStyle: "black-translucent",
  },
  icons: { apple: "/icons/icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0f19",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Mounted above the router so an enforced block can take over from
            whatever screen you happen to be on. */}
        <RingGuard />
        <div className="app">{children}</div>
        <NavBar />
      </body>
    </html>
  );
}
