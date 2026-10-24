"use client";

import { Pause, Play, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { setSourceEnabledAction, syncNowAction } from "./actions";

export function SyncControls({ sourceId, enabled, compact }: { sourceId: string; enabled: boolean; compact?: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => ReturnType<typeof syncNowAction>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message); else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" disabled={pending} onClick={() => run(() => syncNowAction(sourceId, "incremental"))} aria-busy={pending}><RefreshCw className={pending ? "animate-spin" : undefined} /> {pending ? "Syncing…" : "Sync now"}</Button>
      {!compact ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => syncNowAction(sourceId, "full"))}>Full sync and reconcile</Button> : null}
      {!compact ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setSourceEnabledAction(sourceId, !enabled))}>{enabled ? <><Pause /> Pause</> : <><Play /> Resume</>}</Button>
      ) : null}
    </div>
  );
}
