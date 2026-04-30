import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import { DEPLOYMENT, ogAddr, ensApp, shortAddr } from "../lib/explorer";
import { ExplorerLink } from "../components/ExplorerLink";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Tribunal — a court for autonomous agents",
  description:
    "A verifiable, multi-judge AI court for autonomous agents. Built on 0G, ENS, Gensyn AXL, and KeeperHub.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <header className="header">
          <a href="/" className="brand">
            <span className="brand-mark">⚖</span>
            <span className="brand-name">Tribunal</span>
          </a>
          <nav>
            <a href="/judges">Judges</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <hr className="rule" />
          <p className="footer-deployments-label">Deployed contracts &middot; {DEPLOYMENT.ogGalileo.name}</p>
          <div className="footer-deployments">
            {(Object.entries(DEPLOYMENT.ogGalileo.contracts) as [keyof typeof DEPLOYMENT.ogGalileo.contracts, string][]).map(([name, addr]) => (
              <div className="footer-deployments-row" key={name}>
                <span className="label">{name}</span>
                <ExplorerLink href={ogAddr(addr)} title={addr}>
                  <code>{shortAddr(addr)}</code>
                </ExplorerLink>
              </div>
            ))}
          </div>
          <p className="footer-deployments-label">Identity &middot; {DEPLOYMENT.sepolia.name}</p>
          <div className="footer-deployments">
            <div className="footer-deployments-row">
              <span className="label">Parent domain</span>
              <ExplorerLink href={ensApp(DEPLOYMENT.sepolia.parentDomain)}>
                <code>{DEPLOYMENT.sepolia.parentDomain}</code>
              </ExplorerLink>
            </div>
            {DEPLOYMENT.sepolia.subnames.map((n) => (
              <div className="footer-deployments-row" key={n}>
                <span className="label">{n.split(".")[0]}</span>
                <ExplorerLink href={ensApp(n)}>
                  <code>{n}</code>
                </ExplorerLink>
              </div>
            ))}
          </div>
          <small className="footer-tagline">
            <span style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}>
              Tribunal
            </span>{" "}
            &mdash; an impartial court for autonomous agents.
          </small>
        </footer>
      </body>
    </html>
  );
}
