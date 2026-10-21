"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/primitives";

export function CommandCentreFilters({ firms, period, firmId, periods }: { firms: { id: string; name: string }[]; period: string; firmId: string; periods: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next}`);
  };
  return (
    <div className="flex gap-2">
      <label><span className="sr-only">Firm</span>
        <Select value={firmId} onChange={(e) => set("firm", e.target.value)} className="h-8 w-auto text-[13px]">
          <option value="">All sharing firms</option>
          {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </label>
      <label><span className="sr-only">Period</span>
        <Select value={period} onChange={(e) => set("days", e.target.value === "30" ? "" : e.target.value)} className="h-8 w-auto text-[13px]">
          {Object.entries(periods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </label>
    </div>
  );
}
