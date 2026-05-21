export interface FlowRow {
  tag: string;
  summary: string;
  refuted?: boolean;
}

export interface FlowSheetData {
  aff: FlowRow[];
  neg: FlowRow[];
  ballot?: string;
  unrefuted?: { aff: number; neg: number };
}

interface FlowSheetProps {
  flow: FlowSheetData;
}

function SheetColumn({ title, rows }: { title: string; rows: FlowRow[] }) {
  return (
    <section className="flex-1">
      <h4 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      <ul className="space-y-2">
        {rows.length === 0 && <li className="text-sm text-slate-400">No arguments.</li>}
        {rows.map((row, i) => (
          <li
            key={`${title}-${i}`}
            className={`rounded-md border p-3 text-sm ${
              row.refuted
                ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
                : "border-teal/30 bg-white text-slate-700"
            }`}
          >
            <div className="font-medium">{row.tag}</div>
            <div className="mt-1 text-slate-600">{row.summary}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FlowSheet({ flow }: FlowSheetProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <SheetColumn title="Affirmative" rows={flow.aff} />
        <SheetColumn title="Negative" rows={flow.neg} />
      </div>
      {flow.ballot && (
        <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Ballot</div>
          {flow.ballot}
        </div>
      )}
    </div>
  );
}
