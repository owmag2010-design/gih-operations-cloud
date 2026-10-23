"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Greeting and date in the viewer's own time zone (rendered after hydration). */
export function Greeting({ firstName }: { firstName: string }) {
  const now = useSyncExternalStore(noop, () => Math.floor(Date.now() / 60_000), () => null);
  const d = now === null ? null : new Date(now * 60_000);
  const h = d?.getHours();
  const part = h === undefined ? "Welcome back" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <p className="mb-3 min-h-5 text-[12px] font-medium tracking-[0.18em] text-[#ffb3b9] uppercase" suppressHydrationWarning>
        {d ? d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" }) : " "}
      </p>
      <h1 className="font-display text-[42px] leading-none text-white sm:text-[60px]" suppressHydrationWarning>
        {part}, {firstName}.
      </h1>
    </>
  );
}

/** Day of the month in the viewer's time zone. */
export function DayOfMonth({ value }: { value: Date | string }) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  const d = new Date(value);
  return <span suppressHydrationWarning>{client ? d.getDate() : d.getUTCDate()}</span>;
}
