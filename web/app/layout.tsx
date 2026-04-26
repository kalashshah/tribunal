import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tribunal",
  description: "A verifiable AI court for autonomous agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <a href="/" className="brand">Tribunal</a>
          <nav>
            <a href="/file">File a dispute</a>
            <a href="/judges">Judges</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <small>Tribunal · ETHGlobal Open Agents · 2026</small>
        </footer>
      </body>
    </html>
  );
}
