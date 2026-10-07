import { ArrowLeftRight, Handshake } from 'lucide-react';

/**
 * Hét icoon van een dienstruil (Jarno 07-10): overal de twee tegengestelde
 * pijlen, behalve bij een overname (wissel zonder tegenprestatie), die houdt
 * de hand. Tot dan stonden er vier verschillende tekens voor hetzelfde
 * begrip: pijl-terug in de navigatie en de meldingen, herhaal-pijlen in de
 * werkvoorraad en op Vandaag, ververs-pijlen op het dashboard en de
 * tegengestelde pijlen in het rooster en de wizard. De navigatie zelf
 * gebruikt ArrowLeftRight rechtstreeks (routes.tsx wil een LucideIcon).
 */
export function RuilIcoon({ overname = false, size = 16, className }: { overname?: boolean; size?: number; className?: string }) {
  return overname ? <Handshake size={size} className={className} /> : <ArrowLeftRight size={size} className={className} />;
}
