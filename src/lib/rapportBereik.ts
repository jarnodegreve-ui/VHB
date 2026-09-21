import type { RapportBereik, RapportDefinitie } from '../../shared/rapporten/types';
import { bereikToestand, type BereikToestand, type Periode } from '../../shared/rapporten/periode';
import { formatDatumDMJ } from './format';

/**
 * "Periode zonder gegevens" is iets anders dan "filters leveren niets op": de
 * server geeft bij elk rapport mee van wanneer tot wanneer de bron gegevens
 * heeft, en hier wordt daar één zin van gemaakt, dezelfde op het scherm en op
 * het printblad.
 *
 *  - geen-bron  "Er zijn nog geen verlofgegevens geregistreerd." (ook bij een rapport zonder periode,
 *               en met de zin uit `geenBron` van de definitie erachter)
 *  - buiten     "Er zijn pas verlofgegevens vanaf 05/01/2026." (of: "… lopen tot …")
 *  - deels      dezelfde zin, als regel bóven de rijen die er wel zijn
 *  - binnen     geen tekst
 */
export type BereikUitleg = { toestand: BereikToestand; tekst: string | null };

export function bereikUitleg(def: RapportDefinitie, periode: Periode | null, bereik: RapportBereik): BereikUitleg {
  // Een lege bron is leeg, met of zonder periode; de definitie zegt er waar nodig bij waar die gegevens ingevuld worden.
  if (!bereik) return { toestand: 'geen-bron', tekst: [`Er zijn nog geen ${def.bronNaam} geregistreerd.`, def.geenBron?.tekst].filter(Boolean).join(' ') };
  // Een rapport zonder periode (geen periode- of jaarfilter) heeft verder niets om tegen af te zetten.
  if (!periode) return { toestand: 'binnen', tekst: null };
  const toestand = bereikToestand(periode, bereik);
  if (toestand === 'binnen' || toestand === 'geen-bron') return { toestand: 'binnen', tekst: null };
  if (toestand === 'buiten' && periode.van > bereik.tot) {
    return { toestand, tekst: `De ${def.bronNaam} lopen tot ${formatDatumDMJ(bereik.tot)}, deze periode begint later.` };
  }
  return {
    toestand,
    tekst: toestand === 'deels'
      ? `Er zijn pas ${def.bronNaam} vanaf ${formatDatumDMJ(bereik.van)}, het begin van deze periode is dus leeg.`
      : `Er zijn pas ${def.bronNaam} vanaf ${formatDatumDMJ(bereik.van)}.`,
  };
}
