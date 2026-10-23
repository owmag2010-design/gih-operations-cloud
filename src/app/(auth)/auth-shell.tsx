/* eslint-disable @next/next/no-img-element */
import { HubLogo } from "@/components/hub-mark";

/** Frame for sign-in and account-recovery screens, in the Global Immigration Hub brand. */
export function AuthShell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
      <aside className="relative hidden overflow-hidden bg-navy lg:block" aria-hidden="true">
        <img src="/brand/locations-cover.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/70 to-navy/30" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <HubLogo tone="white" className="h-6 w-auto self-start" />
          <div className="max-w-[460px]">
            <p className="text-[11px] font-medium tracking-[0.22em] text-white/70 uppercase">Operations Cloud</p>
            <div className="my-5 h-[3px] w-14 bg-hub-red" />
            <p className="font-display text-[40px] leading-[1.08]">One front door. <em className="text-white/85">Specialist firms behind it.</em></p>
            <p className="mt-4 text-[15px] leading-relaxed text-white/75">The working system for Global Immigration Hub and its partner firms: Veritas Emigrate, Mimshac Group and Nextmove Advisory.</p>
          </div>
          <p className="text-xs text-white/55">Pretoria · Harare · Sydney</p>
        </div>
      </aside>
      <main className="flex flex-col items-center justify-center bg-paper px-4 py-12">
        <div className="w-full max-w-[380px]">
          <HubLogo className="mb-10 h-5 w-auto lg:hidden" />
          <p className="mb-2 text-[11px] font-medium tracking-[0.2em] text-hub-red uppercase">Global Immigration Hub</p>
          <h1 className="font-display text-[34px] leading-tight text-ink">{title}</h1>
          {description ? <div className="mt-2 text-sm text-muted">{description}</div> : null}
          <div className="mt-7">{children}</div>
          <p className="mt-10 text-xs text-muted">Staff access only. Activity is recorded.</p>
        </div>
      </main>
    </div>
  );
}
