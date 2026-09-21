import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { Update } from '../types';
import { openPdfInNewTab } from '../lib/ui';
import { Button } from './primitives';
import { Card } from './Card';

/**
 * De PDF's van een update, zoals een chauffeur ze ziet (puntje Jarno 8).
 *
 * Staat "meteen tonen" aan, dan staat elke PDF ingebed onder de tekst zodra
 * het bericht openklapt. Op een aanraakscherm blijft het altijd een knop:
 * een ingebedde PDF toont daar alleen de eerste pagina (zelfde reden als bij
 * de ritbladen), en dat is misleidend bij een bijlage van meer bladzijden.
 */
export function UpdateBijlagenLezen({ update }: { update: Update }) {
  const [touchToestel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
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
            onClick={() => b.url && openPdfInNewTab(b.url)}
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
    </section>
  );
}
