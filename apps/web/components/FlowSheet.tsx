export interface FlowRow {
  tag: string;
  summary: string;
  refuted?: boolean;
}

export type FlowItem = FlowRow;

export interface AffSheetRow {
  contention: FlowItem;
  neg_responses?: FlowItem[];
  aff_defense?: FlowItem[];
  status?: string;
  judge_note?: string;
}

export interface NegSheetRow {
  contention: FlowItem;
  aff_rebuttals?: FlowItem[];
  status?: string;
  judge_note?: string;
}

export interface FlowBallot {
  aff_unrefuted?: number;
  neg_unrefuted?: number;
  winner?: "aff" | "neg" | string;
  explanation?: string;
}

export interface FlowVoter {
  tag: string;
  winner?: "aff" | "neg" | string;
  reason?: string;
}

export interface FlowSheetData {
  aff?: FlowRow[];
  neg?: FlowRow[];
  ballot?: string | FlowBallot;
  unrefuted?: { aff: number; neg: number };
  aff_sheet?: AffSheetRow[];
  neg_sheet?: NegSheetRow[];
  dropped?: FlowItem[];
  voters?: FlowVoter[];
  recommended_drills?: string[];
}

interface FlowSheetProps {
  flow: FlowSheetData;
}

type CardTone = "aff" | "affOutline" | "neg" | "negOutline" | "missing";

const cardBase = "min-h-24 rounded-md border p-4 text-sm shadow-sm";

function normalizeItem(item: FlowItem | undefined, fallback: string): FlowItem {
  return {
    tag: item?.tag || fallback,
    summary: item?.summary || "Open transcripts for details.",
    refuted: item?.refuted,
  };
}

function hasStructuredFlow(flow: FlowSheetData): boolean {
  return Boolean(flow.aff_sheet?.length || flow.neg_sheet?.length);
}

function ballotText(ballot: FlowSheetData["ballot"]): string | null {
  if (!ballot) return null;
  if (typeof ballot === "string") return ballot;
  return ballot.explanation || null;
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
            className={`${cardBase} ${
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

function FlowCard({
  label,
  item,
  tone,
}: {
  label: string;
  item: FlowItem;
  tone: CardTone;
}) {
  const toneClass: Record<CardTone, string> = {
    aff: "border-blue-200 border-l-4 border-l-blue-500 bg-blue-50 text-slate-900",
    affOutline: "border-blue-300 border-l-4 border-l-blue-500 bg-white text-slate-900",
    neg: "border-rose-200 border-l-4 border-l-rose-500 bg-rose-50 text-slate-900",
    negOutline: "border-rose-300 border-l-4 border-l-rose-500 bg-white text-slate-900",
    missing: "border-amber-200 border-l-4 border-l-amber-600 bg-amber-50 text-slate-900",
  };
  const labelClass: Record<CardTone, string> = {
    aff: "text-blue-600",
    affOutline: "text-blue-600",
    neg: "text-rose-600",
    negOutline: "text-rose-600",
    missing: "text-slate-700",
  };

  return (
    <div className={`${cardBase} ${toneClass[tone]}`}>
      <div className={`text-[11px] font-bold uppercase tracking-wide ${labelClass[tone]}`}>
        {label}
      </div>
      <div className="mt-1 font-semibold leading-snug">{item.tag}</div>
      <p className="mt-1 leading-relaxed text-slate-700">{item.summary}</p>
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden items-center justify-center text-lg text-slate-500 lg:flex">
      -&gt;
    </div>
  );
}

function MissingCard({
  label,
  title,
  summary,
}: {
  label: string;
  title: string;
  summary: string;
}) {
  return <FlowCard label={label} tone="missing" item={{ tag: title, summary }} />;
}

function FlowNote({ status, note }: { status?: string; note?: string }) {
  return (
    <div className="min-h-24 rounded-md border border-teal/15 bg-teal/5 p-4 text-sm text-slate-700">
      <span className="inline-flex rounded-full bg-teal/10 px-3 py-1 text-xs font-bold text-teal-dark">
        {status || "contested"}
      </span>
      <p className="mt-3 leading-relaxed">{note || "No judge note generated."}</p>
    </div>
  );
}

function AffFlowRow({ row }: { row: AffSheetRow }) {
  const contention = normalizeItem(row.contention, "Aff contention");
  const negResponses = row.neg_responses ?? [];
  const affDefense = row.aff_defense ?? [];
  const stretchRow = negResponses.length > 1 || affDefense.length > 1;

  return (
    <div
      className={`grid gap-3 lg:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_minmax(11rem,0.8fr)] ${
        stretchRow ? "items-stretch" : "items-start"
      }`}
    >
      <FlowCard label="Aff contention" item={contention} tone="aff" />
      <Arrow />
      <div className="space-y-3">
        {negResponses.length > 0 ? (
          negResponses.map((item, index) => (
            <FlowCard
              key={`neg-response-${index}`}
              label="Neg response"
              item={normalizeItem(item, "Neg response")}
              tone="negOutline"
            />
          ))
        ) : (
          <MissingCard
            label="No neg response"
            title="Dropped"
            summary="This contention appears unrefuted."
          />
        )}
      </div>
      <Arrow />
      <div className="space-y-3">
        {affDefense.length > 0 ? (
          affDefense.map((item, index) => (
            <FlowCard
              key={`aff-defense-${index}`}
              label="Aff defense"
              item={normalizeItem(item, "Aff defense")}
              tone="affOutline"
            />
          ))
        ) : (
          <MissingCard
            label="No aff defense"
            title="Not extended"
            summary="No later defense was identified."
          />
        )}
      </div>
      <FlowNote status={row.status} note={row.judge_note} />
    </div>
  );
}

function NegFlowRow({ row }: { row: NegSheetRow }) {
  const contention = normalizeItem(row.contention, "Neg contention");
  const affRebuttals = row.aff_rebuttals ?? [];
  const stretchRow = affRebuttals.length > 1;

  return (
    <div
      className={`grid gap-3 lg:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_minmax(11rem,0.8fr)] ${
        stretchRow ? "items-stretch" : "items-start"
      }`}
    >
      <FlowCard label="Neg contention" item={contention} tone="neg" />
      <Arrow />
      <div className="space-y-3">
        {affRebuttals.length > 0 ? (
          affRebuttals.map((item, index) => (
            <FlowCard
              key={`aff-rebuttal-${index}`}
              label="Aff rebuttal"
              item={normalizeItem(item, "Aff rebuttal")}
              tone="affOutline"
            />
          ))
        ) : (
          <MissingCard
            label="No aff rebuttal"
            title="Dropped"
            summary="This contention appears unrefuted."
          />
        )}
      </div>
      <FlowNote status={row.status} note={row.judge_note} />
    </div>
  );
}

function ReviewGrid({ flow }: { flow: FlowSheetData }) {
  const voters = flow.voters ?? [];
  const drops = flow.dropped ?? [];
  const drills = flow.recommended_drills ?? [];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-teal-dark">Voters</h4>
        {voters.length > 0 ? (
          <div className="space-y-2">
            {voters.map((voter, index) => (
              <div
                key={`voter-${index}`}
                className="rounded-md border border-slate-200 bg-white p-3 text-sm"
              >
                <div className="font-semibold text-slate-900">{voter.tag}</div>
                {voter.winner && (
                  <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {voter.winner}
                  </div>
                )}
                {voter.reason && <p className="mt-1 text-slate-600">{voter.reason}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No voters generated.</p>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-teal-dark">Drops</h4>
        {drops.length > 0 ? (
          <div className="space-y-2">
            {drops.map((drop, index) => (
              <div
                key={`drop-${index}`}
                className="rounded-md border border-slate-200 bg-white p-3 text-sm"
              >
                <div className="font-semibold text-slate-900">{drop.tag}</div>
                <p className="mt-1 text-slate-600">{drop.summary}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No obvious drops marked.</p>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-teal-dark">Recommended Drills</h4>
        {drills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {drills.map((drill) => (
              <span
                key={drill}
                className="rounded-full bg-teal/10 px-3 py-1 text-xs font-bold text-teal-dark"
              >
                {drill}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No drill recommendation available.</p>
        )}
      </div>
    </section>
  );
}

function StructuredFlowSheet({ flow }: { flow: FlowSheetData }) {
  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-md border border-blue-200 bg-blue-50/45 p-4">
        <h4 className="text-sm font-bold text-teal-dark">Aff Sheet</h4>
        {(flow.aff_sheet ?? []).length > 0 ? (
          flow.aff_sheet!.map((row, index) => (
            <AffFlowRow key={`aff-row-${index}`} row={row} />
          ))
        ) : (
          <p className="text-sm text-slate-400">No affirmative contentions generated.</p>
        )}
      </section>

      <section className="space-y-4 rounded-md border border-rose-200 bg-rose-50/45 p-4">
        <h4 className="text-sm font-bold text-teal-dark">Neg Sheet</h4>
        {(flow.neg_sheet ?? []).length > 0 ? (
          flow.neg_sheet!.map((row, index) => (
            <NegFlowRow key={`neg-row-${index}`} row={row} />
          ))
        ) : (
          <p className="text-sm text-slate-400">No negative contentions generated.</p>
        )}
      </section>

      <ReviewGrid flow={flow} />
    </div>
  );
}

export function FlowSheet({ flow }: FlowSheetProps) {
  if (hasStructuredFlow(flow)) {
    return <StructuredFlowSheet flow={flow} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <SheetColumn title="Affirmative" rows={flow.aff ?? []} />
        <SheetColumn title="Negative" rows={flow.neg ?? []} />
      </div>
      {ballotText(flow.ballot) && (
        <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Ballot</div>
          {ballotText(flow.ballot)}
        </div>
      )}
    </div>
  );
}
