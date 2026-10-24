import { Paperclip } from "lucide-react";
import Link from "next/link";
import { LocalTime } from "@/components/ui/forms";
import type { MirrorField } from "@/server/db/schema";

type Names = Record<string, { name: string | null; sourceId: string; removed: boolean }>;

/** Display an Airtable field value faithfully, with links to mirrored linked records. */
export function FieldValue({ field, value, names, sourceId, recordId, compact }: { field: MirrorField; value: unknown; names: Names; sourceId: string; recordId: string; compact?: boolean }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return <span className="text-muted">—</span>;
  switch (field.type) {
    case "multipleRecordLinks": {
      const ids = (value as unknown[]).filter((x): x is string => typeof x === "string");
      return (
        <span className="flex flex-wrap gap-1">
          {ids.slice(0, compact ? 3 : 200).map((id) => {
            const n = names[id];
            return n ? (
              <Link key={id} href={`/airtable/${n.sourceId}/${id}`} className={`rounded-full bg-sunken px-2 py-0.5 text-xs text-ink hover:underline ${n.removed ? "line-through" : ""}`}>{n.name || id}</Link>
            ) : (
              <span key={id} className="rounded-full border border-dashed border-hairline-strong px-2 py-0.5 text-xs text-muted" title="Linked record isn't in the mirror">{id}</span>
            );
          })}
          {compact && ids.length > 3 ? <span className="text-xs text-muted">+{ids.length - 3}</span> : null}
        </span>
      );
    }
    case "multipleAttachments": {
      const files = value as { id: string; filename: string; size?: number | null }[];
      return (
        <span className="flex flex-col gap-0.5">
          {files.map((f) => (
            <a key={f.id} href={`/api/airtable/attachment?source=${sourceId}&record=${recordId}&field=${field.id}&id=${f.id}`} className="inline-flex items-center gap-1 text-[13px] text-ink underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
              <Paperclip className="size-3.5" /> {f.filename}{f.size ? <span className="text-xs text-muted"> ({Math.max(1, Math.round(f.size / 1024))} KB)</span> : null}
            </a>
          ))}
        </span>
      );
    }
    case "checkbox":
      return <span>{value ? "Yes" : "No"}</span>;
    case "dateTime":
    case "createdTime":
    case "lastModifiedTime":
      return typeof value === "string" ? <LocalTime value={value} /> : <span>{String(value)}</span>;
    case "date":
      return <span className="num">{String(value)}</span>;
    case "url":
      return <a href={String(value)} target="_blank" rel="noopener noreferrer" className="break-all text-ink underline-offset-2 hover:underline">{compact ? String(value).replace(/^https?:\/\//, "").slice(0, 30) : String(value)}</a>;
    case "email":
      return <a href={`mailto:${String(value)}`} className="text-ink underline-offset-2 hover:underline">{String(value)}</a>;
    case "currency":
    case "number":
    case "percent":
    case "count":
    case "autoNumber":
      return <span className="num">{typeof value === "number" ? value.toLocaleString("en-ZA") : String(value)}</span>;
    default: {
      const text = textOf(value);
      if (compact) return <span className="line-clamp-2">{text}</span>;
      return <span className="whitespace-pre-wrap">{text}</span>;
    }
  }
}

function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "email", "text", "label", "value"]) if (typeof o[k] === "string") return o[k] as string;
    if ("state" in o && "value" in o) return textOf(o.value);
    return JSON.stringify(o);
  }
  return String(v);
}

export const TRUTH: Record<string, { label: string; tone: "accent" | "ok" | "warn" }> = {
  airtable: { label: "Airtable is the source of truth", tone: "accent" },
  dashboard: { label: "The dashboard is the source of truth", tone: "ok" },
  shared: { label: "Shared: kept in both", tone: "warn" },
};
