import { LocalTime } from "@/components/ui/forms";
import { EmptyState } from "@/components/ui/primitives";
import { ACTIVITY_LABELS, FIELD_LABELS } from "@/lib/labels";

type Item = { id: string; type: string; body: string | null; data: Record<string, unknown>; createdAt: string; actorName: string | null };

function describe(item: Item, stageName: (id: string) => string) {
  const d = item.data ?? {};
  switch (item.type) {
    case "stage_change":
      return `Moved to ${(d.toName as string) ?? stageName(d.to as string)}`;
    case "updated":
      return `Updated ${((d.fields as string[]) ?? []).map((f) => FIELD_LABELS[f] ?? f).join(", ")}`;
    case "assignment":
      return d.to ? "Assignment changed" : "Unassigned";
    case "consent":
      return `Consent ${d.granted ? "given" : "refused"} for ${String(d.purpose).replace("_", " ")}`;
    case "duplicate_flagged":
      return d.of ? `Marked as a duplicate of ${d.of}` : `Possible duplicate of ${((d.refs as string[]) ?? []).join(", ")}`;
    case "converted":
      return `Converted to client ${d.clientRef ?? ""}`;
    case "proposal":
      return `${item.body ?? "Proposal updated"}${d.ref && !(item.body ?? "").includes(String(d.ref)) ? ` (${d.ref})` : ""}`;
    case "created":
      return d.fromLead ? `Created from lead ${d.fromLead}` : "Created";
    default:
      return ACTIVITY_LABELS[item.type] ?? item.type;
  }
}

/** Activity feed for leads and clients. Notes are shown in full; other events as one line. */
export function Timeline({ items, stages = [] }: { items: Item[]; stages?: { id: string; name: string }[] }) {
  if (!items.length) return <EmptyState title="No activity yet" />;
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? "another stage";
  return (
    <ol className="relative px-4 py-3">
      {items.map((item) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-1">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.type === "note" ? "bg-accent" : "bg-hairline-strong"}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink-2">
              <span className="font-medium text-ink">{item.actorName ?? (item.type === "proposal" ? "Client" : "System")}</span>{" "}
              {item.type === "note" ? "added a note" : describe(item, stageName).replace(/^./, (c) => c.toLowerCase())}
              <span className="ml-2 text-xs text-muted"><LocalTime value={item.createdAt} mode="relative" /></span>
            </p>
            {item.type === "note" && item.body ? <p className="mt-1 max-w-[75ch] rounded-md bg-sunken px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{item.body}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
