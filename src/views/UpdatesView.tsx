import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import type { Update } from '../types';
import { cn } from '../lib/ui';
import { fetchMijnUpdateReads, markUpdatesRead } from '../lib/updateReads';
import { formatUpdateDate } from '../lib/format';
import { kiesRecord } from '../lib/overgang';
import { useRecordParam } from '../app/router';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button } from '../components/primitives';
import { DetailPaneel, MasterDetail, useInlinePaneel } from '../components/DetailPaneel';
import { LegeLijst } from '../components/illustraties';
import { LijstKaart, RecordRij } from '../components/RecordRij';
import { UpdateBijlagenLezen } from '../components/UpdateBijlagenLezen';

/**
 * Titels links, het volledige bericht in het gedeelde DetailPaneel: op
 * desktop rechts naast de lijst, op mobiel in een SlideOver.
 *
 * Gelezen = het bericht echt geopend (golf 3, 15-09). Vroeger markeerde het
 * openen van dit scherm álle updates gelezen, waardoor de teller bij
 * Beheer updates "scherm geopend" mat. Nu: een gewone update telt zodra ze
 * in het paneel (desktop) of de SlideOver (mobiel) staat; een dringende pas
 * na een tik op "Gelezen en begrepen" (zelfde patroon als de ruil-
 * bevestiging "Begrepen, ik rijd deze dienst").
 */
export function UpdatesView({ updates }: { updates: Update[] }) {
  // De keuze staat in de URL (/updates/<id>): deelbaar, en een melding over
  // één update landt meteen op dat bericht. Alleen een klik schrijft; de
  // desktop-voorselectie hieronder blijft afgeleid.
  const [selectedId, setSelectedId] = useRecordParam(0, { view: 'updates' });
  const inline = useInlinePaneel();

  // Wat deze gebruiker al las (server), aangevuld met wat hij in deze sessie
  // opent. `telt` = false voor staf: de server registreert hun reads niet,
  // dus krijgen ze ook geen bevestigknop.
  const [gelezen, setGelezen] = useState<Set<string>>(() => new Set());
  const [telt, setTelt] = useState(true);
  const [bevestigBezig, setBevestigBezig] = useState<string | null>(null);
  useEffect(() => {
    let actief = true;
    fetchMijnUpdateReads()
      .then((r) => {
        if (!actief) return;
        setTelt(r.telt);
        setGelezen((prev) => new Set([...prev, ...r.ids]));
      })
      .catch(() => {/* stil: dan markeren we gewoon opnieuw */});
    return () => { actief = false; };
  }, []);

  // Desktop: het nieuwste bericht staat standaard open; verdwijnt de keuze
  // (bericht verwijderd), dan valt het paneel terug op het eerste. Mobiel:
  // alleen wat de chauffeur zelf opentikte.
  const gekozen = updates.find((u) => u.id === selectedId) ?? null;
  // K (24-09): een dringend bericht dat nog niet bevestigd is staat bovenaan,
  // daarna alles van nieuw naar oud (de lijst kwam van oud naar nieuw binnen).
  const gesorteerd = useMemo(() => {
    const dringendOpen = (u: Update) => u.isUrgent && !gelezen.has(u.id);
    return [...updates].sort((a, b) => Number(dringendOpen(b)) - Number(dringendOpen(a)) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [updates, gelezen]);
  const detail = inline ? gekozen ?? updates[0] ?? null : gekozen;

  const markeer = (id: string) => {
    setGelezen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    return markUpdatesRead([id]).catch(() => {
      // Bij een fout blijft de id ongemarkeerd, zodat het later opnieuw geprobeerd wordt.
      setGelezen((prev) => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
    });
  };

  // Een gewoon bericht is gelezen zodra het open staat; per id één keer per
  // sessie, ook als de server-lijst nog niet binnen is.
  const gemeld = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!detail || detail.isUrgent || gelezen.has(detail.id) || gemeld.current.has(detail.id)) return;
    gemeld.current.add(detail.id);
    void markeer(detail.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const bevestig = async (id: string) => {
    if (bevestigBezig) return;
    setBevestigBezig(id);
    try { await markeer(id); } finally { setBevestigBezig(null); }
  };

  const toonBevestiging = !!detail?.isUrgent && telt;
  const bevestigd = !!detail && gelezen.has(detail.id);

  return (
    <PageShell>
      <PageHeader
        title="Updates"
        description="Berichten en mededelingen."
      />

      {updates.length === 0 ? (
        <EmptyState
          illustratie={<LegeLijst />}
          title="Geen updates"
          message="Er zijn nog geen berichten geplaatst."
        />
      ) : (
        <MasterDetail
          lijst={(
            // Het rijrecept (RecordRij, 22-09): één lijstkaart met hairlines in
            // plaats van een losse kaart per bericht met een dikke streep. De
            // streep blijft alleen voor wat dringend is; een grijze streep bij
            // elk gewoon bericht zei niets.
            <LijstKaart aria-label="Berichten">
              {gesorteerd.map((update) => (
                <RecordRij
                  key={update.id}
                  titel={update.title}
                  titelAttrs={{ 'data-vt-record': update.id }}
                  meta={formatUpdateDate(update.date)}
                  status={(
                    <>
                      {update.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                      {update.isUrgent && telt && gelezen.has(update.id) && <Badge tone="emerald" stil>Bevestigd</Badge>}
                    </>
                  )}
                  accent={update.isUrgent ? 'dringend' : undefined}
                  // Eerste regel als voorproef: op mobiel scan je zo de lijst
                  // zonder elk bericht te openen.
                  voorproef={update.content}
                  richting="rechts"
                  actief={detail?.id === update.id}
                  onClick={() => kiesRecord(update.id, detail?.id ?? null, () => setSelectedId(update.id))}
                />
              ))}
            </LijstKaart>
          )}
          paneel={(
            <DetailPaneel
              open={!!detail}
              onClose={() => setSelectedId(null)}
              title={detail?.title ?? 'Bericht'}
              subtitle={detail ? formatUpdateDate(detail.date) : undefined}
              sleutel={detail?.id}
              leegTekst="Kies een bericht."
              icon={(
                <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', detail?.isUrgent ? 'bg-red-500/12 text-red-700' : 'bg-slate-500/12 text-slate-600')}>
                  <Bell size={16} />
                </span>
              )}
              footer={toonBevestiging && detail ? (
                bevestigd ? (
                  <p className="flex items-center gap-2 text-body-sm font-medium text-emerald-700">
                    <Check size={16} aria-hidden="true" />
                    Gelezen en begrepen
                  </p>
                ) : (
                  /* Dringend: pas gelezen als de chauffeur het zelf zegt (een
                     push bereikt bijna niemand, deze knop wel). */
                  <Button
                    variant="success"
                    size="lg"
                    full
                    icon={<Check size={16} />}
                    bezig={bevestigBezig === detail.id}
                    onClick={() => void bevestig(detail.id)}
                  >
                    Gelezen en begrepen
                  </Button>
                )
              ) : undefined}
            >
              {detail && (
                <article className="space-y-4" aria-label={detail.title}>
                  {detail.isUrgent && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="red" dot>Dringend</Badge>
                    </div>
                  )}
                  <p className="max-w-2xl text-body font-normal text-slate-600 whitespace-pre-wrap">{detail.content}</p>
                  <UpdateBijlagenLezen update={detail} />
                </article>
              )}
            </DetailPaneel>
          )}
        />
      )}
    </PageShell>
  );
}
