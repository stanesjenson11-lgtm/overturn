/**
 * The mark: a line that drops and turns back up, an arrowhead at its end.
 * A decision going down, then reversed. It's drawn with the theme's accent
 * tokens, so it follows light and dark mode; app/icon.svg (the favicon) is the
 * same drawing with fixed colours, because a favicon can't read CSS.
 */
export function Mark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <path
        d="M8.5 9.5V17a5.5 5.5 0 0 0 11 0v-5.5M15.5 15l4-4 4 4"
        fill="none"
        className="stroke-accent-ink"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The wordmark: the mark beside the name, set in the app's serif. */
export default function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark className={size === "lg" ? "size-9" : "size-7"} />
      <span
        className={`font-serif font-semibold tracking-tight text-ink ${size === "lg" ? "text-2xl" : "text-xl"}`}
      >
        Overturn
      </span>
    </span>
  );
}
