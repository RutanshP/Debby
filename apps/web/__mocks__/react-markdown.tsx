import type { ReactNode } from "react";

/**
 * Test-only stand-in for react-markdown (real package is pure ESM and
 * heavy to transform under Jest). Renders just enough markdown to satisfy
 * existing tests: `#`/`##`/`###` headings; everything else stays as text.
 */
export default function ReactMarkdown({ children }: { children: ReactNode }) {
  if (typeof children !== "string") {
    return <div data-testid="markdown">{children}</div>;
  }
  const lines = children.split("\n");
  return (
    <div data-testid="markdown">
      {lines.map((line, i) => {
        const h3 = /^###\s+(.*)$/.exec(line);
        if (h3) return <h3 key={i}>{h3[1]}</h3>;
        const h2 = /^##\s+(.*)$/.exec(line);
        if (h2) return <h2 key={i}>{h2[1]}</h2>;
        const h1 = /^#\s+(.*)$/.exec(line);
        if (h1) return <h1 key={i}>{h1[1]}</h1>;
        if (line.trim() === "") return <br key={i} />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}
