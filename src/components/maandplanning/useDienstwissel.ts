import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import { WISSEL_REDENEN, type Cellen, type Chauffeur, type GekozenCel } from '../../lib/maandplanning';

/**
 * De handmatige dienstwissel en het terugdraaien van een wissel op de
 * geopende cel van de Maandplanning (alleen voor admins zichtbaar; de server
 * dwingt de rol óók af via requireRole). Verplaatst uit CapacityView.tsx op
 * 09-10 (stap 3 van de splitsing), byte voor byte dezelfde toestand en
 * schrijfacties; het gedrag ligt vast in useDienstwissel.test.tsx. De cel
 * zelf (`selected`, `sluit`) komt van useCelDetail, het bord (`drivers`,
 * `cells`) van de view; `herlaad` is de tik die de maand na een wissel
 * herlaadt, zodat de dienst meteen bij de nieuwe chauffeur staat.
 */
export function useDienstwissel({ selected, sluit, drivers, cells, herlaad }: {
  selected: GekozenCel | null;
  sluit: () => void;
  drivers: Chauffeur[];
  cells: Cellen;
  herlaad: () => void;
}) {
  const [wisselNaar, setWisselNaar] = useState('');
  const [wisselReden, setWisselReden] = useState<string>(WISSEL_REDENEN[0]);
  const [wisselToelichting, setWisselToelichting] = useState('');
  const [wisselBevestigen, setWisselBevestigen] = useState(false);
  const [isWisselen, setIsWisselen] = useState(false);

  // Vers formulier per geopende cel — restjes van een vorige cel mogen nooit
  // stil in een bevestiging belanden.
  useEffect(() => {
    setWisselNaar('');
    setWisselReden(WISSEL_REDENEN[0]);
    setWisselToelichting('');
  }, [selected?.driverId, selected?.iso]);

  const wisselRedenTekst = wisselReden === 'Andere correctie'
    ? wisselToelichting.trim()
    : (wisselToelichting.trim() ? `${wisselReden}, ${wisselToelichting.trim()}` : wisselReden);
  const wisselKlaar = !!wisselNaar && !!wisselRedenTekst;

  // Welke dienst is hier over te zetten? Een dienst-cel spreekt voor zich;
  // op een afwezigheidscel (ziek/bv/kv) is dat de dienst die eronder ligt —
  // ziek melden haalt de dienst niet uit de planning, dus die moet juist dán
  // herverdeeld worden. Zonder dit was het hoofdscenario onbereikbaar.
  const wisselDienst = selected
    ? (selected.cell.kind === 'service' ? selected.cell.code : (selected.cell.hiddenService ?? null))
    : null;
  const wisselNaAfwezigheid = !!wisselDienst && selected?.cell.kind !== 'service';

  // Rijdt de gekozen chauffeur die dag zelf een dienst, dan wordt het een
  // 1-op-1-wissel (Jarno 14-09): zijn dienst gaat in ruil naar de huidige
  // chauffeur. Niet vanaf een afwezigheidscel: wie ziek is krijgt er geen
  // dienst bij (die kandidaten staan dan ook niet in de lijst).
  const wisselNaarCel = selected && wisselNaar ? cells[wisselNaar]?.[selected.iso] : undefined;
  const wisselTerug = !wisselNaAfwezigheid && wisselNaarCel?.kind === 'service' ? wisselNaarCel.code : null;
  const wisselNaarNaam = drivers.find((d) => String(d.id) === wisselNaar)?.name ?? '—';

  const uitvoerenWissel = async () => {
    if (!selected || !wisselDienst || !wisselKlaar || isWisselen) return;
    setIsWisselen(true);
    try {
      const res = await apiFetch('/api/admin/shift-swap', {
        method: 'POST',
        body: JSON.stringify({
          date: selected.iso,
          line: wisselDienst,
          fromDriverId: selected.driverId,
          toDriverId: wisselNaar,
          reason: wisselRedenTekst,
          ...(wisselTerug ? { returnLine: wisselTerug } : {}),
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { meldSchrijffout('Dienstwissel', { status: res.status, message: body.error }); return; }
      notify(wisselTerug
        ? `Diensten ${wisselDienst} en ${wisselTerug} gewisseld, beide chauffeurs krijgen een melding.`
        : `Dienst ${wisselDienst} overgezet, beide chauffeurs krijgen een melding.`, 'success');
      sluit();
      herlaad();
    } catch (err) {
      meldSchrijffout('Dienstwissel', err);
    } finally {
      setIsWisselen(false);
    }
  };

  // Wissel terugdraaien: de ruil annuleren draait de planning mee terug
  // (revertSwapFromPlanning server-side) — dat is de nette weg, en scheelt
  // de omweg via het Dienstruil-scherm om de juiste aanvraag op te zoeken.
  const [terugdraaien, setTerugdraaien] = useState(false);
  const [isTerugdraaien, setIsTerugdraaien] = useState(false);
  const uitvoerenTerugdraai = async () => {
    if (!selected?.cell.swapId || isTerugdraaien) return;
    setIsTerugdraaien(true);
    try {
      const res = await apiFetch(`/api/swaps/${encodeURIComponent(selected.cell.swapId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', ifStatus: 'approved' }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { meldSchrijffout('Terugdraaien', { status: res.status, message: body.error }, () => void uitvoerenTerugdraai()); return; }
      notify('Wissel teruggedraaid, de dienst staat weer op de oorspronkelijke chauffeur.', 'success');
      sluit();
      herlaad();
    } catch (err) {
      meldSchrijffout('Terugdraaien', err, () => void uitvoerenTerugdraai());
    } finally {
      setIsTerugdraaien(false);
    }
  };

  return {
    wisselDienst, wisselNaAfwezigheid,
    wisselNaar, setWisselNaar, wisselReden, setWisselReden, wisselToelichting, setWisselToelichting,
    wisselTerug, wisselNaarNaam, wisselKlaar, wisselRedenTekst,
    isWisselen, wisselBevestigen, setWisselBevestigen, uitvoerenWissel,
    terugdraaien, setTerugdraaien, isTerugdraaien, uitvoerenTerugdraai,
  };
}

export type Dienstwissel = ReturnType<typeof useDienstwissel>;
