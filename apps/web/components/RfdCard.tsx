interface RfdCardProps {
  winnerSide?: "aff" | "neg" | null;
  winnerLabel?: string | null;
  rfd: string;
}

const SIDE_LABEL: Record<string, string> = {
  aff: "Affirmative",
  neg: "Negative",
};

function formatLines(rfd: string): string[] {
  const lines = rfd
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) return lines;

  return rfd
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function RfdCard({ winnerSide, winnerLabel, rfd }: RfdCardProps) {
  const lines = formatLines(rfd);
  const displayWinner = winnerLabel ?? (winnerSide ? SIDE_LABEL[winnerSide] : null);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Reason for Decision</h3>
        {displayWinner && (
          <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
            Winner: {displayWinner}
          </span>
        )}
      </header>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">
        {lines.map((line, index) => {
          const [label, ...rest] = line.split(":");
          const hasLabel = rest.length > 0 && label.length <= 28;
          return (
            <p key={`${line}-${index}`}>
              {hasLabel ? (
                <>
                  <span className="font-semibold text-slate-900">{label}:</span>
                  <span> {rest.join(":").trim()}</span>
                </>
              ) : (
                line
              )}
            </p>
          );
        })}
      </div>
    </article>
  );
}
