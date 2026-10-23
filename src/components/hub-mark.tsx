/* eslint-disable @next/next/no-img-element */
/** Global Immigration Hub icon (red circle G). Official artwork from /public/brand. */
export function HubMark({ className, variant = "red" }: { className?: string; variant?: "red" | "white" | "navy" }) {
  return <img src={`/brand/gih-icon-${variant}.svg`} alt="" aria-hidden="true" className={className} />;
}

/** Full horizontal Global Immigration Hub wordmark. */
export function HubLogo({ className, tone = "navy" }: { className?: string; tone?: "navy" | "white" }) {
  return <img src={`/brand/gih-logo-horizontal-${tone}.svg`} alt="Global Immigration Hub" className={className} />;
}
