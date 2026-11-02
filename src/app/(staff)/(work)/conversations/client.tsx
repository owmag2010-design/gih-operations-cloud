"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/primitives";

/** Re-reads the page from the server every few seconds while the tab is visible, so new messages appear. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Search by name, email, phone, matter or proposal reference; keeps the other filters. */
export function SearchBox({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(defaultValue);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams(params.toString());
        if (q.trim()) p.set("q", q.trim());
        else p.delete("q");
        p.delete("c");
        router.push(`${pathname}${p.size ? `?${p}` : ""}`);
      }}
    >
      <label htmlFor="conv-search" className="sr-only">Search conversations</label>
      <Input id="conv-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or reference" />
    </form>
  );
}
