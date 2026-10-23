"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { searchAction } from "@/app/(staff)/shell-actions";
import type { SearchHit } from "@/server/modules/search";
import { Dialog, DialogContent } from "../ui/dialog";

type Link = { label: string; href: string };

/** ⌘K / Ctrl+K: jump anywhere, search records across permitted firms, start common actions. */
export function CommandPalette({ navigation, quickActions }: { navigation: Link[]; quickActions: Link[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !open && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(() => start(async () => setHits(await searchAction(query))), 180);
    return () => clearTimeout(t);
  }, [query]);

  const shownHits = query.trim().length >= 2 ? hits : [];
  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const item = "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-[13px] text-ink data-[selected=true]:bg-sunken";
  const group = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-2.5 rounded-full border border-hairline-strong bg-surface px-3.5 text-sm text-muted hover:border-ink-2/40 max-2xl:w-10 max-2xl:justify-center max-2xl:px-0 2xl:w-64"
        aria-label="Search and jump (Ctrl K)"
      >
        <Search className="size-4" />
        <span className="max-2xl:sr-only">Search clients, enquiries, pages…</span>
        <kbd className="ml-auto rounded-md border border-hairline-strong px-1.5 text-[11px] text-muted max-2xl:hidden">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Search and jump" description="Find leads, clients and enquiries you can access, or go to a page." className="[&>div:last-child]:p-0">
          <Command shouldFilter={false} label="Search and jump" className="flex flex-col">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Name, email, phone or reference…"
              className="h-11 border-b border-hairline px-4 text-sm outline-none placeholder:text-muted"
              autoFocus
            />
            <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
              {pending ? <Command.Loading><p className="px-2.5 py-2 text-[13px] text-muted">Searching…</p></Command.Loading> : null}
              {query.trim().length >= 2 && !pending && shownHits.length === 0 ? <p className="px-2.5 py-2 text-[13px] text-muted">No records match “{query.trim()}”.</p> : null}
              {shownHits.length ? (
                <Command.Group heading="Records" className={group}>
                  {shownHits.map((h) => (
                    <Command.Item key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h.href)} className={item}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{h.title}</span>
                        <span className="block truncate text-xs text-muted">{h.subtitle}</span>
                      </span>
                      <span className="text-xs text-muted capitalize">{h.kind}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {quickActions.length && query.trim().length < 2 ? (
                <Command.Group heading="Actions" className={group}>
                  {quickActions.map((a) => (
                    <Command.Item key={a.href} value={`a-${a.href}`} onSelect={() => go(a.href)} className={item}>{a.label}</Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Go to" className={group}>
                {navigation
                  .filter((n) => !query.trim() || n.label.toLowerCase().includes(query.trim().toLowerCase()))
                  .map((n) => (
                    <Command.Item key={n.href + n.label} value={`n-${n.href}-${n.label}`} onSelect={() => go(n.href)} className={item}>{n.label}</Command.Item>
                  ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
