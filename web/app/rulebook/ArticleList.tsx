"use client";
import { useEffect, useState } from "react";
import styles from "./article.module.css";

interface Article {
  id: string;
  title: string;
  body: string;
  ensName: string;
  ensNode: string;
  chapter: string;
  resolved: boolean;
  reason?: string;
}

interface Articles {
  ruleBook: string;
  articleCount: number;
  resolvedCount: number;
  articles: Article[];
  cached: boolean;
}

const ENS_APP = "https://sepolia.app.ens.domains";

export function ArticleList() {
  const [d, setD] = useState<Articles | null>(null);

  useEffect(() => {
    fetch("/api/rulebook/articles").then((r) => r.json()).then(setD);
  }, []);

  if (!d) return <p className="text-sm">Loading rulebook (resolving ENS records on Sepolia)…</p>;
  if (!d.articles?.length) {
    return (
      <p className="text-sm opacity-70">
        Registry is empty. Run <code>scripts/seed-rulebook-ens.ts</code> to
        publish ENS subnames and add articles.
      </p>
    );
  }

  return (
    <div>
      <div className="mt-3" style={{ width: "100%" }}>
        {d.articles.map((a) => (
          <ArticleRow key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function ArticleRow({ a }: { a: Article }) {
  const disabled = !a.resolved;
  return (
    <details
      className={`${styles.article} border-t`}
      style={{ borderColor: "var(--rule, #ddd)", width: "100%" }}
    >
      <summary
        style={{
          cursor: disabled ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 0",
          width: "100%",
          minWidth: 0,
        }}
        onClick={disabled ? (e) => e.preventDefault() : undefined}
      >
        <span aria-hidden className={styles.chevron}>
          {disabled ? "" : "▸"}
        </span>
        <code style={{ flexShrink: 0, width: "4rem" }}>{a.id}</code>
        <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {a.title}
          {!a.resolved && (
            <span title={a.reason} style={{ color: "#c00", fontSize: "0.85em", marginLeft: "0.5rem" }}>
              ⚠ unresolved
            </span>
          )}
        </span>
        <a
          href={`${ENS_APP}/${a.ensName}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
          onClick={(e) => e.stopPropagation()}
          title={a.ensName}
          style={{
            fontFamily: "monospace",
            fontSize: "0.8em",
            flexShrink: 0,
            maxWidth: "16rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {a.ensName}
        </a>
      </summary>
      {a.resolved && (
        <p
          style={{
            paddingLeft: "6.75rem",
            paddingRight: "1rem",
            paddingBottom: "0.75rem",
            fontSize: "0.875rem",
            opacity: 0.8,
            overflowWrap: "anywhere",
            margin: 0,
          }}
        >
          {a.body}
        </p>
      )}
    </details>
  );
}
