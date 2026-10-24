import Link from "next/link";
import { cn } from "@/components/ui/primitives";

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "invoices", label: "Invoices", path: "/invoices" },
  { key: "payments", label: "Payments", path: "/payments" },
  { key: "proposals", label: "Proposals", path: null },
  { key: "settings", label: "Billing settings", path: "/settings" },
] as const;

/** Sub-navigation shared by the finance pages. */
export function FinanceTabs({ slug, current, showSettings }: { slug: string; current: (typeof TABS)[number]["key"]; showSettings: boolean }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-hairline pb-2 text-[13px]" aria-label="Finance">
      {TABS.filter((t) => t.key !== "settings" || showSettings).map((t) => {
        const href = t.path === null ? `/f/${slug}/proposals` : `/f/${slug}/finance${t.path}`;
        return (
          <Link key={t.key} href={href} aria-current={current === t.key ? "page" : undefined} className={cn("rounded-md px-2.5 py-1", current === t.key ? "bg-sky font-medium text-ink" : "text-muted hover:text-ink")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
