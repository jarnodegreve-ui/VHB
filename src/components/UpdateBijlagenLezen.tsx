import { Suspense, useState } from 'react';
import { FileText } from 'lucide-react';
import type { PdfBijlage, Update } from '../types';
// Lui geladen: de viewer en pdfjs horen niet in de startbundel of de warmup.
import { LazyBijlageViewer } from '../app/lazyViews';
import { Button } from './primitives';
import { Card } from './Card';

/**
 * De PDF's van een update, zoals een chauffeur ze ziet (puntje Jarno 8).
 *
 * Staat "meteen tonen" aan, dan staat elke PDF ingebed onder de tekst zodra
 * het bericht openklapt. Op een aanraakscherm blijft het altijd een knop:
 * een ingebedde PDF toont daar alleen de eerste pagina (zelfde reden als bij
 * de ritbladen), en dat is misleidend bij een bijlage van meer bladzijden.
 *
 * De knop opent de bijlage in de app (BijlageViewer): terug sluit de viewer en
 * laat het bericht open staan.
 */
export function UpdateBijlagenLezen({ update }: { update: Update }) {
  const [touchToestel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  // undefined = nog nooit geopend, null = gesloten na een opening.
  const [open, setOpen] = useState<PdfBijlage | null>();
  const bijlagen = (update.bijlagen ?? []).filter((b) => b.url);
  if (bijlagen.length === 0) return null;
  const ingebed = Boolean(update.bijlagenTonen) && !touchToestel;

  return (
    <section aria-label="Bijlagen" className="space-y-2">
      {bijlagen.map((b) => (
        <div key={b.slot} className="space-y-2">
          <Button
            variant="secondary"
            size="lg"
            full
            icon={<FileText size={18} />}
            onClick={() => setOpen(b)}
          >
            <span className="truncate">{b.filename}</span>
          </Button>
          {ingebed && (
            <Card padding="none" className="overflow-hidden">
              <iframe
                src={b.url}
                title={b.filename}
                className="h-[70vh] min-h-[420px] w-full bg-surface-white"
              />
            </Card>
          )}
        </div>
      ))}
      {open !== undefined && (
        <Suspense fallback={null}>
          <LazyBijlageViewer soort="update" recordId={update.id} bijlage={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </section>
  );
}
