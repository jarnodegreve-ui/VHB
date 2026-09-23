import { Download } from 'lucide-react';
import type { Service } from '../types';
import { downloadBlob } from '../lib/ui';
import { dienstoverzichtCsv } from '../lib/dienstoverzichtExport';
import { PageHeader, PageShell } from '../components/ui';
import { Button } from '../components/primitives';
import { DienstTabel, DienstZijvak, useDienstLijst } from '../components/dienstoverzicht/DienstTabel';
import { vandaagBrussel } from '../lib/brussel';

export function ServicesView({ services }: { services: Service[] }) {
  // Sorteren op de kolomkoppen (3D.1); standaard op dienstnummer, zoals de
  // oude sorteerschakelaar in de kop.
  const lijst = useDienstLijst(services, 'dienst');

  // De CSV volgt wat je ziet: het zoekresultaat in de getoonde volgorde.
  const downloadCSV = () => {
    const blob = new Blob([dienstoverzichtCsv(lijst.gesorteerd)], { type: 'text/csv;charset=utf-8;' });
    void downloadBlob(`dienstoverzicht_${vandaagBrussel()}.csv`, blob);
  };

  return (
    <PageShell>
      <PageHeader view="dienstoverzicht" title="Dienstoverzicht" />
      <DienstTabel
        services={services}
        lijst={lijst}
        leegTekst="De planning heeft nog geen diensten klaargezet."
        // Zonder diensten voegt het vak niets toe.
        zijvak={services.length > 0 ? (
          <DienstZijvak
            services={services}
            voet={(
              <Button variant="secondary" size="sm" onClick={downloadCSV} icon={<Download size={14} />}>
                CSV downloaden
              </Button>
            )}
          />
        ) : undefined}
      />
    </PageShell>
  );
}
