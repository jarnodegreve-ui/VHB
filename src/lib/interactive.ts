/**
 * Dagdeel-greeting in NL.
 */
export function getDaypartGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return 'Goedenacht';
  if (h < 12) return 'Goedemorgen';
  if (h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}
