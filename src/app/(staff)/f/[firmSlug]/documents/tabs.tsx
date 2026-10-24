import Link from "next/link";
import { cn } from "@/components/ui/primitives";

/** Sub-navigation for Documents & Templates. */
export function DocumentTabs({ slug, current, show }: { slug: string; current: "documents" | "templates" | "email"; show: { templates: boolean; email: boolean } }) {
  const tabs = [
    { key: "documents", label: "Documents", href: `/f/${slug}/documents`, on: true },
    { key: "templates", label: "Document templates", href: `/f/${slug}/documents/templates`, on: show.templates },
    { key: "email", label: "Email templates", href: `/f/${slug}/templates`, on: show.email },
  ].filter((t) => t.on);
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-hairline pb-2 text-[13px]" aria-label="Documents and templates">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={current === t.key ? "page" : undefined} className={cn("rounded-md px-2.5 py-1", current === t.key ? "bg-sky font-medium text-ink" : "text-muted hover:text-ink")}>{t.label}</Link>
      ))}
    </nav>
  );
}
