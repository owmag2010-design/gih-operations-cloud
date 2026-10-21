/** Simple Hub monogram in GIH red. (Placeholder until the official logo file is added to /public.) */
export function HubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--hub-red)" />
      <path d="M22.5 11.2A8 8 0 1 0 24 17h-7.2" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
