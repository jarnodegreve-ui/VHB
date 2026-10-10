import type { Service } from '../types';
import { variantenTekst } from '../../shared/dagtype';
import { csvTekst } from './csv';

/** CSV van het dienstoverzicht: dienstnummer + de drie dienstblokken, en
 *  sinds 10-10 de afwijkingen per dagtype als leesbare tekst in de laatste
 *  kolom. Eén bron voor de chauffeurs- én de beheerkant — kop en rijen
 *  stonden 2× woordelijk (controle-ronde 27-08, bevinding 21). */
export const dienstoverzichtCsv = (services: Service[]): string => {
  const headers = ['Dienstnummer', 'Start 1', 'Eind 1', 'Loop 1', 'Start 2', 'Eind 2', 'Loop 2', 'Start 3', 'Eind 3', 'Loop 3', 'Afwijkingen per dagtype'];
  const rows = services.map((s) => [
    s.serviceNumber, s.startTime, s.endTime, s.loopnr || '',
    s.startTime2 || '', s.endTime2 || '', s.loopnr2 || '',
    s.startTime3 || '', s.endTime3 || '', s.loopnr3 || '',
    variantenTekst(s.varianten),
  ]);
  return csvTekst([headers, ...rows]);
};
