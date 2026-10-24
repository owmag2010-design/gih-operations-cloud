"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/primitives";

export function ClientSearch({ initial, label = "Search clients", placeholder = "Name, email, phone, reference" }: { initial: string; label?: string; placeholder?: string }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get("q") ?? "") === q) return;
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}?${next}`);
    }, 300);
    return () => clearTimeout(id);
  }, [q, params, pathname, router]);
  return (
    <label className="relative w-full sm:w-64">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8 pl-8 text-[13px]" />
    </label>
  );
}
