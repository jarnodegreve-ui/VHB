import { useState, type ReactNode } from 'react';
import { Bell, Bus, Check, Download, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { PageHeader, PageShell, EmptyState } from '../../components/ui';
import { Card, CardHeader } from '../../components/Card';
import { Badge, Button, Chip, FilterChip, IconButton, MicroLabel, StatusBadge, Switch, TableShell, Td, Th } from '../../components/primitives';
import { Field, Input, Select, Textarea } from '../../components/Field';
import { InfoTip } from '../../components/InfoTip';
import { BulkBar, Checkbox, Paginering, SortTh, TableToolbar, useSort } from '../../components/Table';
import { Skeleton, SkeletonRow, SkeletonTile } from '../../components/Skeleton';
import { DUR } from '../../lib/motion';
import { notify } from '../../lib/ui';

/**
 * Designsysteem — alle bouwstenen, tokens en toestanden op één pagina
 * (admin). Doel: de huisstijl tastbaar maken, nieuwe schermen bouwen op
 * bestaande primitieven i.p.v. tweelingen, en één scherm dat in de visuele
 * regressie (scripts/mobile-audit.mjs) élke primitief in licht én donker
 * vastlegt. Geen eigen stijlen hier: alles wat je ziet is de primitief zelf.
 */

const FAMILIES = ['slate', 'oker', 'amber', 'emerald', 'red', 'blue', 'rose'] as const;
const STAPPEN = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
// Statische klassenlijst: Tailwind v4 genereert alleen wat letterlijk in de
// bron staat — een template-string zou lege vlakken geven.
const SWATCH: Record<(typeof FAMILIES)[number], Record<(typeof STAPPEN)[number], string>> = {
  slate: { 50: 'bg-slate-50', 100: 'bg-slate-100', 200: 'bg-slate-200', 300: 'bg-slate-300', 400: 'bg-slate-400', 500: 'bg-slate-500', 600: 'bg-slate-600', 700: 'bg-slate-700', 800: 'bg-slate-800', 900: 'bg-slate-900' },
  oker: { 50: 'bg-oker-50', 100: 'bg-oker-100', 200: 'bg-oker-200', 300: 'bg-oker-300', 400: 'bg-oker-400', 500: 'bg-oker-500', 600: 'bg-oker-600', 700: 'bg-oker-700', 800: 'bg-oker-800', 900: 'bg-oker-900' },
  amber: { 50: 'bg-amber-50', 100: 'bg-amber-100', 200: 'bg-amber-200', 300: 'bg-amber-300', 400: 'bg-amber-400', 500: 'bg-amber-500', 600: 'bg-amber-600', 700: 'bg-amber-700', 800: 'bg-amber-800', 900: 'bg-amber-900' },
  emerald: { 50: 'bg-emerald-50', 100: 'bg-emerald-100', 200: 'bg-emerald-200', 300: 'bg-emerald-300', 400: 'bg-emerald-400', 500: 'bg-emerald-500', 600: 'bg-emerald-600', 700: 'bg-emerald-700', 800: 'bg-emerald-800', 900: 'bg-emerald-900' },
  red: { 50: 'bg-red-50', 100: 'bg-red-100', 200: 'bg-red-200', 300: 'bg-red-300', 400: 'bg-red-400', 500: 'bg-red-500', 600: 'bg-red-600', 700: 'bg-red-700', 800: 'bg-red-800', 900: 'bg-red-900' },
  blue: { 50: 'bg-blue-50', 100: 'bg-blue-100', 200: 'bg-blue-200', 300: 'bg-blue-300', 400: 'bg-blue-400', 500: 'bg-blue-500', 600: 'bg-blue-600', 700: 'bg-blue-700', 800: 'bg-blue-800', 900: 'bg-blue-900' },
  rose: { 50: 'bg-rose-50', 100: 'bg-rose-100', 200: 'bg-rose-200', 300: 'bg-rose-300', 400: 'bg-rose-400', 500: 'bg-rose-500', 600: 'bg-rose-600', 700: 'bg-rose-700', 800: 'bg-rose-800', 900: 'bg-rose-900' },
};

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'success', 'warning', 'danger', 'dangerSolid', 'ink'] as const;
const BADGE_TONES = ['slate', 'oker', 'emerald', 'red', 'amber', 'blue'] as const;
const CHIP_TONES = ['slate', 'oker', 'emerald', 'red', 'amber', 'blue', 'rose'] as const;
const CARD_TONES = ['default', 'muted', 'dashed', 'accent', 'warning', 'danger', 'success', 'info'] as const;
const STATUSSEN = ['pending', 'approved', 'rejected', 'cancelled', 'active', 'inactive'];
const RADII = [['md', 'rounded-md'], ['lg', 'rounded-lg'], ['xl', 'rounded-xl'], ['2xl', 'rounded-2xl'], ['3xl', 'rounded-3xl']] as const;
const ICOON_LADDER = [12, 14, 16, 18, 20, 24] as const;

const RIJEN = [
  { id: '1', naam: 'Bart Peeters', dienst: '2601', status: 'approved' },
  { id: '2', naam: 'An Claes', dienst: '2614', status: 'pending' },
  { id: '3', naam: 'Tom Wouters', dienst: '2632', status: 'rejected' },
];

function Sectie({ id, titel, uitleg, children }: { id: string; titel: string; uitleg?: string; children: ReactNode }) {
  return (
    <Card as="section" padding="md" className="space-y-4 scroll-mt-20" id={id} aria-labelledby={`${id}-titel`}>
      <CardHeader title={<span id={`${id}-titel`}>{titel}</span>} description={uitleg} />
      {children}
    </Card>
  );
}

function Rij({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:items-start">
      <MicroLabel className="pt-2">{label}</MicroLabel>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const INHOUD = [
  ['kleur', 'Kleur'], ['typografie', 'Typografie'], ['maat', 'Maat en beweging'], ['knoppen', 'Knoppen'], ['labels', 'Badges en chips'],
  ['kaarten', 'Kaarten'], ['formulier', 'Formulier'], ['tabel', 'Tabel'], ['feedback', 'Feedback'],
] as const;

export function DesignsysteemView() {
  const [aan, setAan] = useState(true);
  const [filter, setFilter] = useState<'alle' | 'open'>('alle');
  const [zoek, setZoek] = useState('');
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(1);
  const sort = useSort<'naam' | 'dienst'>('naam');
  const [fout, setFout] = useState(false);

  const rijen = sort.sorteer([...RIJEN], (r, k) => r[k])
    .filter((r) => (filter === 'open' ? r.status === 'pending' : true))
    .filter((r) => r.naam.toLowerCase().includes(zoek.toLowerCase()))
    

  return (
    <PageShell>
      <PageHeader
        title="Designsysteem"
        description="Alle bouwstenen, tokens en toestanden van het portaal — in licht en donker, zoals ze in de app staan."
      />
      <nav aria-label="Inhoud" className="flex flex-wrap gap-2">
        {INHOUD.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="ios-pressable rounded-full border border-slate-200 bg-paper px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900">
            {label}
          </a>
        ))}
      </nav>

      <Sectie id="kleur" titel="Kleur" uitleg="Warm goud (oker, anker 500) is het merk; amber is de waarschuwingskleur. In dark mode spiegelen de schalen: 50–300 worden transparante tinten, 700–900 lichte tekst.">
        <div className="space-y-3">
          {FAMILIES.map((fam) => (
            <div key={fam} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
              <MicroLabel>{fam}</MicroLabel>
              <div className="grid grid-cols-10 gap-1">
                {STAPPEN.map((stap) => (
                  <div key={stap} className={`h-8 rounded-md ${SWATCH[fam][stap]}`} role="img" aria-label={`${fam}-${stap}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <Rij label="Vlakken">
          <div className="h-8 w-24 rounded-md bg-paper ring-1 ring-rim" role="img" aria-label="bg-paper" />
          <div className="h-8 w-24 rounded-md bg-surface-muted" role="img" aria-label="bg-surface-muted" />
          <div className="h-8 w-24 rounded-md bg-ink" role="img" aria-label="bg-ink" />
          <div className="h-8 w-24 rounded-md bg-oker-500" role="img" aria-label="bg-oker-500" />
        </Rij>
        <Rij label="Tekst">
          <span className="text-slate-900">slate-900 kop</span>
          <span className="text-slate-600">slate-600 body</span>
          <span className="text-slate-500">slate-500 gedempt</span>
          <span className="text-oker-700">oker-700 accent</span>
          <span className="text-emerald-700">emerald-700</span>
          <span className="text-red-700">red-700</span>
          <span className="text-amber-700">amber-700</span>
        </Rij>
      </Sectie>

      <Sectie id="typografie" titel="Typografie" uitleg="Manrope ExtraBold voor koppen, Inter voor de rest. Vijf rollen; geen losse tekstmaten in views.">
        <div className="space-y-3">
          <p className="text-page-title">Paginatitel · text-page-title</p>
          <p className="text-section-title">Sectietitel · text-section-title</p>
          <p className="text-card-title">Kaarttitel · text-card-title</p>
          <p className="text-sm text-slate-600">Body · text-sm slate-600 — De dienst begint om 05:42 aan de stelplaats.</p>
          <p className="text-label">Label · text-label</p>
          <p className="text-micro">Micro · text-micro</p>
          <p className="text-sm tabular-nums text-slate-600">Cijfers · tabular-nums 05:42 · 2601 · 24 dagen</p>
        </div>
      </Sectie>

      <Sectie id="maat" titel="Maat en beweging" uitleg="Radius-ladder md/lg/xl/2xl/3xl, iconen op 12/14/16/18/20/24 met lucide 1.75, drie duraties met één easing.">
        <Rij label="Radius">
          {RADII.map(([naam, klasse]) => (
            <div key={naam} className={`flex h-12 w-16 items-center justify-center bg-surface-muted text-micro ${klasse}`}>{naam}</div>
          ))}
        </Rij>
        <Rij label="Iconen">
          {ICOON_LADDER.map((maat) => (
            <span key={maat} className="flex flex-col items-center gap-1 text-slate-600">
              <Bus size={maat} />
              <span className="text-micro">{maat}</span>
            </span>
          ))}
        </Rij>
        <Rij label="Beweging">
          {(Object.keys(DUR) as Array<keyof typeof DUR>).map((naam) => (
            <span key={naam} className="group inline-flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-xs font-semibold text-slate-600">
              <span
                className="h-2 w-2 rounded-full bg-oker-500 transition-transform group-hover:translate-x-3"
                style={{ transitionDuration: `${DUR[naam] * 1000}ms` }}
              />
              {naam} · {Math.round(DUR[naam] * 1000)} ms
            </span>
          ))}
        </Rij>
      </Sectie>

      <Sectie id="knoppen" titel="Knoppen" uitleg="Button in acht varianten en drie maten; IconButton voor icoon-alleen (label verplicht); FilterChip als aan/uit-filter; Switch voor instellingen.">
        {(['sm', 'md', 'lg'] as const).map((maat) => (
          <Rij key={maat} label={`Button ${maat}`}>
            {BUTTON_VARIANTS.map((v) => (
              <Button key={v} variant={v} size={maat}>{v}</Button>
            ))}
          </Rij>
        ))}
        <Rij label="Met icoon">
          <Button variant="primary" size="sm"><Plus size={16} />Nieuw</Button>
          <Button variant="secondary" size="sm"><Download size={16} />Exporteren</Button>
          <Button variant="secondary" size="sm" disabled>Uitgeschakeld</Button>
        </Rij>
        <Rij label="IconButton">
          <IconButton label="Bewerken" variant="ghost"><Pencil size={18} /></IconButton>
          <IconButton label="Zoeken" variant="secondary"><Search size={18} /></IconButton>
          <IconButton label="Bevestigen" variant="success"><Check size={18} /></IconButton>
          <IconButton label="Verwijderen" variant="danger"><Trash2 size={18} /></IconButton>
          <IconButton label="Toevoegen" variant="primary"><Plus size={18} /></IconButton>
          <IconButton label="Sluiten" variant="ghost" size="sm"><X size={16} /></IconButton>
        </Rij>
        <Rij label="FilterChip">
          <FilterChip active={filter === 'alle'} onClick={() => setFilter('alle')}>Alle</FilterChip>
          <FilterChip active={filter === 'open'} onClick={() => setFilter('open')}>Open</FilterChip>
          <FilterChip active tone="red" icon={<Bell size={14} />}>Dringend</FilterChip>
        </Rij>
        <Rij label="Switch">
          <Switch checked={aan} onChange={setAan} label="Meldingen" />
          <Switch checked={false} onChange={() => {}} label="Uitgeschakeld" disabled />
        </Rij>
      </Sectie>

      <Sectie id="labels" titel="Badges en chips" uitleg="Badge voor status en tellingen (zes tinten, optionele dot); Chip voor codes en nummers (mono); StatusBadge vertaalt een status naar tint en tekst.">
        <Rij label="Badge">{BADGE_TONES.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}</Rij>
        <Rij label="Badge · dot">{BADGE_TONES.map((t) => <Badge key={t} tone={t} dot>{t}</Badge>)}</Rij>
        <Rij label="Chip">{CHIP_TONES.map((t) => <Chip key={t} tone={t}>2601</Chip>)}</Rij>
        <Rij label="StatusBadge">{STATUSSEN.map((s) => <StatusBadge key={s} status={s} />)}</Rij>
      </Sectie>

      <Sectie id="kaarten" titel="Kaarten" uitleg="Card in acht tinten en vier paddings; CardHeader met eyebrow, titel, beschrijving en aside. Uitleg hoort in een InfoTip, niet als alinea in de kaart.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CARD_TONES.map((t) => (
            <Card key={t} tone={t} padding="sm">
              <CardHeader title={t} aside={<Badge tone="slate">aside</Badge>} className="flex-row items-baseline" />
              <p className="mt-1 text-sm text-slate-600">Kaartinhoud in tint {t}.</p>
            </Card>
          ))}
        </div>
        <Rij label="CardHeader">
          <Card padding="sm" className="w-full">
            <CardHeader eyebrow="Eyebrow" title="Titel met uitleg" description="Een beschrijving van één regel onder de titel." aside={<InfoTip label="Uitleg bij deze kaart">Zo ziet een InfoTip eruit: korte uitleg in een popover, geen alinea in de kaart.</InfoTip>} />
          </Card>
        </Rij>
      </Sectie>

      <Sectie id="formulier" titel="Formulier" uitleg="Field zorgt voor label, hint en fout (aria-describedby); fouten staan bij het veld, nooit in een toast.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" required hint="Voornaam en achternaam.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} placeholder="Bart Peeters" />}
          </Field>
          <Field label="E-mailadres" error={fout ? 'Vul een geldig e-mailadres in.' : undefined}>
            {({ id, describedBy, invalid }) => <Input id={id} type="email" aria-describedby={describedBy} invalid={invalid} defaultValue="bart@vhb" onBlur={() => setFout(true)} />}
          </Field>
          <Field label="Rol">
            {({ id }) => (
              <Select id={id} defaultValue="chauffeur">
                <option value="chauffeur">Chauffeur</option>
                <option value="planner">Planner</option>
                <option value="admin">Beheerder</option>
              </Select>
            )}
          </Field>
          <Field label="Opmerking" hint="Optioneel.">
            {({ id }) => <Textarea id={id} rows={2} placeholder="Korte toelichting…" />}
          </Field>
        </div>
        <Rij label="Checkbox">
          <Checkbox checked={aan} onChange={setAan} label="Ik ga akkoord" />
          <Checkbox checked={false} indeterminate onChange={() => {}} label="Gedeeltelijk" />
        </Rij>
      </Sectie>

      <Sectie id="tabel" titel="Tabel" uitleg="TableToolbar (zoek, telling, filters, acties), sorteerbare koppen, selectie met BulkBar en paginering — hetzelfde recept in elke beheertabel.">
        <TableToolbar
          zoek={zoek}
          onZoek={setZoek}
          placeholder="Zoek op naam…"
          telling={`${rijen.length} van ${RIJEN.length}`}
          filters={<><FilterChip active={filter === 'alle'} onClick={() => setFilter('alle')}>Alle</FilterChip><FilterChip active={filter === 'open'} onClick={() => setFilter('open')}>Open</FilterChip></>}
          acties={<Button variant="primary" size="sm"><Plus size={16} />Nieuw</Button>}
        />
        {gekozen.size > 0 && (
          <BulkBar aantal={gekozen.size} onWis={() => setGekozen(new Set())}>
            <Button variant="secondary" size="sm">Exporteren</Button>
            <Button variant="danger" size="sm">Verwijderen</Button>
          </BulkBar>
        )}
        <TableShell>
          <thead>
            <tr>
              <Th className="w-10"><Checkbox checked={gekozen.size === rijen.length && rijen.length > 0} indeterminate={gekozen.size > 0 && gekozen.size < rijen.length} onChange={(v) => setGekozen(v ? new Set(rijen.map((r) => r.id)) : new Set())} label="Alles selecteren" /></Th>
              <SortTh kolom="naam" sort={sort}>Naam</SortTh>
              <SortTh kolom="dienst" sort={sort} align="right">Dienst</SortTh>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rijen.map((r) => (
              <tr key={r.id}>
                <Td><Checkbox checked={gekozen.has(r.id)} onChange={(v) => setGekozen((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} label={`Selecteer ${r.naam}`} /></Td>
                <Td>{r.naam}</Td>
                <Td className="text-right"><Chip>{r.dienst}</Chip></Td>
                <Td><StatusBadge status={r.status} /></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <Paginering totaal={48} perPagina={20} pagina={pagina} onPagina={setPagina} />
      </Sectie>

      <Sectie id="feedback" titel="Feedback" uitleg="Skeletons tijdens het laden, EmptyState met een volgende stap, toasts kort en met hooguit één actie.">
        <Rij label="Skeleton">
          <div className="w-full space-y-2"><SkeletonRow /><SkeletonRow /></div>
          <SkeletonTile className="w-40" />
          <Skeleton className="h-4 w-32" />
        </Rij>
        <div className="grid gap-3 lg:grid-cols-2">
          <EmptyState title="Nog geen omleidingen" message="Voeg de eerste omleiding toe; chauffeurs zien ze meteen op Mijn dag." action={<Button variant="primary" size="sm"><Plus size={16} />Omleiding toevoegen</Button>} />
          <EmptyState title="Alles afgehandeld" message="Er staan geen aanvragen meer open." />
        </div>
        <Rij label="Toast">
          <Button variant="secondary" size="sm" onClick={() => notify('Opgeslagen.', 'success')}>Succes</Button>
          <Button variant="secondary" size="sm" onClick={() => notify('Dat is niet gelukt. Probeer opnieuw.', 'error')}>Fout</Button>
          <Button variant="secondary" size="sm" onClick={() => notify('Even geduld, de import loopt.', 'info')}>Info</Button>
        </Rij>
      </Sectie>
    </PageShell>
  );
}
