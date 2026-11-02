/**
 * Practice brand accents for the Command Deck. Each practice has a dark-mode
 * accent (bright enough to read on the deck) and a light-mode accent (deep
 * enough for white text). Practices without a tuned palette use their stored
 * brand colour.
 */
export type Accent = { base: string; hover: string; ink: string };
/** The practice's card on "My day": its own brand surface. */
export type Tile = { bg: string; fg: string; sub: string; mark: string; markInk: string; arrow: string; border?: string };
export type PracticePalette = { dark: Accent; light: Accent; tile: Tile };

const HUB: PracticePalette = {
  dark: { base: "#dd1929", hover: "#f0323f", ink: "#ffffff" },
  light: { base: "#1b263b", hover: "#24324c", ink: "#ffffff" },
  tile: { bg: "#1b263b", fg: "#ffffff", sub: "#c9d1df", mark: "#dd1929", markInk: "#ffffff", arrow: "#ffb3b9" },
};

const PRACTICES: Record<string, PracticePalette> = {
  veritas: {
    dark: { base: "#c0367a", hover: "#d24a8c", ink: "#ffffff" },
    light: { base: "#9e1f63", hover: "#b12a73", ink: "#ffffff" },
    tile: { bg: "#0f0f0f", fg: "#faf7f4", sub: "#c9c0b8", mark: "#9e1f63", markInk: "#ffffff", arrow: "#e6a930" },
  },
  mimshac: {
    dark: { base: "#e6a930", hover: "#f0bc52", ink: "#1a1406" },
    light: { base: "#8a5d08", hover: "#9e6c0c", ink: "#ffffff" },
    tile: { bg: "#272525", fg: "#ffffff", sub: "#cfcac2", mark: "#e6a930", markInk: "#272525", arrow: "#e6a930" },
  },
  // Nextmove Advisory: navy #1B2448 and red #ED1C24 (nextmoveza.com).
  nextmove: {
    dark: { base: "#ed1c24", hover: "#ff3d44", ink: "#ffffff" },
    light: { base: "#1b2448", hover: "#2a3566", ink: "#ffffff" },
    tile: { bg: "#1b2448", fg: "#ffffff", sub: "#c3c8dc", mark: "#ed1c24", markInk: "#ffffff", arrow: "#ff5a66" },
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function practicePalette(slug: string | null, brandColor?: string | null): PracticePalette {
  if (!slug) return HUB;
  const tuned = PRACTICES[slug];
  if (tuned) return tuned;
  const c = brandColor && HEX.test(brandColor) ? brandColor : HUB.light.base;
  return {
    dark: { base: c, hover: c, ink: "#ffffff" },
    light: { base: c, hover: c, ink: "#ffffff" },
    tile: { bg: "#ffffff", fg: "#1d2230", sub: "#5f6575", mark: c, markInk: "#ffffff", arrow: c, border: "#e2ddd3" },
  };
}

/** CSS variables the shell sets; globals.css maps them to --accent per theme. */
export function accentVars(p: PracticePalette): Record<string, string> {
  return {
    "--a-dark": p.dark.base,
    "--a-dark-hover": p.dark.hover,
    "--a-dark-ink": p.dark.ink,
    "--a-dark-soft": rgba(p.dark.base, 0.16),
    "--a-dark-glow": rgba(p.dark.base, 0.1),
    "--a-light": p.light.base,
    "--a-light-hover": p.light.hover,
    "--a-light-ink": p.light.ink,
    "--a-light-soft": rgba(p.light.base, 0.08),
    "--firm": p.light.base,
  };
}

/** A practice's own artwork, copied from its website (public/brand/firms). */
export type FirmBrand = { mark: string; logo: string; logoWhite: string; logoHeight: number };

const BRANDS: Record<string, FirmBrand> = {
  veritas: { mark: "/brand/firms/veritas-mark.png", logo: "/brand/firms/veritas-logo.png", logoWhite: "/brand/firms/veritas-logo-white.png", logoHeight: 42 },
  mimshac: { mark: "/brand/firms/mimshac-mark.png", logo: "/brand/firms/mimshac-logo.png", logoWhite: "/brand/firms/mimshac-logo-white.png", logoHeight: 38 },
  nextmove: { mark: "/brand/firms/nextmove-mark.png", logo: "/brand/firms/nextmove-logo.svg", logoWhite: "/brand/firms/nextmove-logo-white.svg", logoHeight: 34 },
};

/** Looks a practice up by its slug or its name (e.g. "Veritas Emigrate"). */
export function firmBrand(slugOrName: string | null | undefined): FirmBrand | null {
  if (!slugOrName) return null;
  const k = slugOrName.toLowerCase();
  if (BRANDS[k]) return BRANDS[k];
  const hit = Object.keys(BRANDS).find((b) => k.includes(b));
  return hit ? BRANDS[hit] : null;
}
