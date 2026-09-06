import { Badge } from './primitives';

/**
 * Omgevingslabel: alleen zichtbaar als de build met `VITE_OMGEVING=staging`
 * gemaakt is (Vercel Preview van het staging-project, zie
 * supabase/staging/README.md). Stil en klein — een tester mag een preview
 * nooit voor productie aanzien, maar het hoeft niet te schreeuwen. In
 * productie (variabele leeg of afwezig) rendert dit niets.
 */
const OMGEVING = String(import.meta.env.VITE_OMGEVING ?? '').trim().toLowerCase();

export function OmgevingLabel({ className }: { className?: string }) {
  if (OMGEVING !== 'staging') return null;
  return <Badge tone="oker" stil className={className}>Staging</Badge>;
}
