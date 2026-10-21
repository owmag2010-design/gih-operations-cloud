import { HubMark } from "@/components/hub-mark";

/** Frame for sign-in and account-recovery screens. */
export function AuthShell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 pt-[12vh] pb-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2.5">
          <HubMark className="size-7" />
          <div className="leading-tight">
            <p className="text-[13px] font-semibold text-ink">Global Immigration Hub</p>
            <p className="text-xs text-muted">Operations Cloud</p>
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <div className="mt-1.5 text-sm text-muted">{description}</div> : null}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
