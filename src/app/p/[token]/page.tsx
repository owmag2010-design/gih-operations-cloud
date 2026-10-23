import type { Metadata } from "next";
import { HubLogo } from "@/components/hub-mark";
import { Notice } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { getPublicProposal } from "@/server/modules/proposals/proposals";
import { RespondForm } from "./respond-form";

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };

const ACCENT: Record<string, string> = { veritas: "#9e1f63", mimshac: "#c88a14" };
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** The client's view of a sent proposal. No sign-in: the unguessable link is the key. */
export default async function PublicProposalPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const p = await getPublicProposal(token);
  if (!p) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <HubLogo className="mb-8 h-5 w-auto self-start" />
        <h1 className="font-display text-3xl text-ink">This link isn&apos;t available</h1>
        <p className="mt-3 text-sm text-muted">It may have been replaced with a newer one, or withdrawn. Please contact your consultant for a current link.</p>
      </main>
    );
  }
  const s = p.snapshot;
  const accent = ACCENT[s.firm.slug] ?? "#1b263b";
  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-navy text-white" style={{ borderBottom: `4px solid ${accent}` }}>
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-display text-2xl">{s.firm.tradingName}</p>
              <p className="text-[11px] tracking-[0.18em] text-white/60 uppercase">A partner firm of Global Immigration Hub</p>
            </div>
            <HubLogo tone="white" className="hidden h-4 w-auto opacity-80 sm:block" />
          </div>
          <div>
            <p className="text-xs tracking-[0.2em] text-white/60 uppercase">Proposal · {s.ref} · Version {s.version}</p>
            <h1 className="font-display mt-2 text-[34px] leading-tight">{s.title}</h1>
            <p className="mt-2 text-white/75">Prepared for {s.recipientName} · {longDate(s.releasedAt)} · Valid until {longDate(s.validUntil)}</p>
          </div>
          <a href={`/p/${token}/pdf`} className="self-start rounded-md border border-white/30 px-3.5 py-2 text-sm hover:bg-white/10">Download PDF</a>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-10">
        {p.status === "accepted" ? <Notice tone="ok">You accepted this proposal{p.responseName ? ` as ${p.responseName}` : ""}. Thank you.</Notice> : null}
        {p.status === "declined" ? <Notice tone="neutral">You declined this proposal. Contact your consultant if you&apos;d like to revisit it.</Notice> : null}
        {p.expired ? <Notice tone="warn">This proposal has expired. Please ask your consultant for a new link.</Notice> : null}

        {s.sections.filter((x) => x.body.trim()).map((sec, i) => (
          <section key={sec.key}>
            <p className="text-xs tracking-[0.2em] uppercase" style={{ color: accent }}>{String(i + 1).padStart(2, "0")}</p>
            <h2 className="font-display mt-1 text-2xl text-ink">{sec.title}</h2>
            <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-ink-2">
              {sec.body.split(/\n{2,}/).map((para, j) => <p key={j} className="whitespace-pre-wrap">{para}</p>)}
            </div>
          </section>
        ))}

        <section>
          <p className="text-xs tracking-[0.2em] uppercase" style={{ color: accent }}>Your investment</p>
          <h2 className="font-display mt-1 text-2xl text-ink">Fees</h2>
          <table className="mt-4 w-full text-[14px]">
            <tbody>
              {s.items.map((it, i) => (
                <tr key={i} className="border-b border-hairline align-top">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-ink">{it.label}{it.quantity > 1 ? ` × ${it.quantity}` : ""}</p>
                    {it.lines.length > 1 ? <ul className="mt-1 text-xs text-muted">{it.lines.map((l) => <li key={l.label}>{l.label}: {formatMoney(l.amountMinor, s.currency)}</li>)}</ul> : null}
                  </td>
                  <td className="num py-3 text-right text-ink">{formatMoney(it.unitMinor * it.quantity, s.currency)}</td>
                </tr>
              ))}
              <tr><td className="pt-3 font-semibold text-ink">Total</td><td className="num pt-3 text-right text-lg font-semibold text-ink">{formatMoney(s.totalMinor, s.currency)}</td></tr>
            </tbody>
          </table>
          <div className="mt-5 border-l-[3px] bg-white px-4 py-3 text-[14px]" style={{ borderColor: accent }}>
            <p className="font-medium text-ink">To begin: {formatMoney(s.depositMinor, s.currency)} deposit</p>
            <p className="text-ink-2">The balance of {formatMoney(s.totalMinor - s.depositMinor, s.currency)} is due before submission.</p>
          </div>
        </section>

        {p.status === "released" && !p.expired ? (
          <section className="rounded-lg border border-hairline bg-white p-6">
            <h2 className="font-display text-2xl text-ink">Your decision</h2>
            <p className="mt-1 mb-5 text-sm text-muted">Accepting confirms the scope and fees above. We&apos;ll then send payment details for the deposit.</p>
            <RespondForm token={token} accent={accent} />
          </section>
        ) : null}

        <footer className="border-t border-hairline pt-6 text-xs text-muted">
          {s.firm.legalName}{s.firm.contactEmail ? ` · ${s.firm.contactEmail}` : ""}{s.firm.contactPhone ? ` · ${s.firm.contactPhone}` : ""}
          <br />Global Immigration Hub centres: Pretoria · Harare
        </footer>
      </main>
    </div>
  );
}
