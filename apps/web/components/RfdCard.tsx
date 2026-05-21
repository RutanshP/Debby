interface RfdCardProps {
  winnerSide?: "aff" | "neg" | null;
  rfd: string;
}

const SIDE_LABEL: Record<string, string> = {
  aff: "Affirmative",
  neg: "Negative",
};

export function RfdCard({ winnerSide, rfd }: RfdCardProps) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Reason for Decision</h3>
        {winnerSide && (
          <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
            Winner: {SIDE_LABEL[winnerSide] ?? winnerSide}
          </span>
        )}
      </header>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{rfd}</p>
    </article>
  );
}
