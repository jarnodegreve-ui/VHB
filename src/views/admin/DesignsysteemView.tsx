import { useId, useState, type ReactNode } from 'react';
import { ArrowUpRight, Bell, Bus, Check, ChevronDown, Download, Info, LogOut, Pencil, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import { ConfirmationModal, ModalHeader, PageHeader, PageShell, EmptyState, Foutkaart, VersheidRegel } from '../../components/ui';
import { Card, CardHeader } from '../../components/Card';
import { Badge, Button, Chip, FilterChip, IconButton, Kbd, Meter, MeterVulling, MicroLabel, Pressable, Segmented, StatusBadge, Switch, Tabel, TableShell, Td, Th } from '../../components/primitives';
import { DateInput, Field, Input, SearchField, Select, Textarea } from '../../components/Field';
import { Formulier } from '../../components/Formulier';
import { useModalSluiten } from '../../components/Modal';
import { useVeldfouten } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { z } from 'zod';
import { ACCOUNT_STATUS } from '../../../shared/status';
import { MenuItem, Popover, PopoverKop, PopoverVoet } from '../../components/Popover';
import { useDropdown } from '../../components/useDropdown';
import { Tooltip } from '../../components/Tooltip';
import { Tabs, TabPaneel } from '../../components/Tabs';
import { Sheet } from '../../components/Sheet';
import { Modal } from '../../components/Modal';
import { Callout } from '../../components/Callout';
import { Stat } from '../../components/Stat';
import { OpsStat } from '../../components/ops';
import { Uitklap, uitklapChevron } from '../../components/Uitklap';
import { InfoTip } from '../../components/InfoTip';
import { BulkBar, CelKnop, Checkbox, Paginering, SortTh, StickyThead, TableToolbar, rijKlik, useSort } from '../../components/Table';
import { VervalPil } from '../../components/VervalPil';
import { Skeleton, SkeletonRow, SkeletonTile } from '../../components/Skeleton';
import { Avatar } from '../../components/Avatar';
import { LijstKaart, RecordRij } from '../../components/RecordRij';
import { BrandLogo } from '../../components/BrandLogo';
import { BrandSpinner } from '../../components/BrandSpinner';
import { LijnTegel } from '../../components/LijnTegel';
import { ActieMenu } from '../../components/ActieMenu';
import { Zijvak, ZijvakRij, ZijvakTekst } from '../../components/Zijvak';
import { DUR } from '../../lib/motion';
import { notify } from '../../lib/ui';
import { AllesGedaan, Fout, GeenBereik, LegeLijst, NietGevonden } from '../../components/illustraties';
import { JaarKiezer, Periodekiezer } from '../../components/Periodekiezer';

/** Demo-schema voor de formuliersectie: dezelfde bouwstenen als de echte
 *  schema's in shared/schemas, met NL-foutteksten per veld. */
const DEMO_SCHEMA = z.object({
  naam: z.string().trim().min(1, 'Vul een naam in.'),
  email: z.string().trim().min(1, 'Vul een e-mailadres in.').email('Vul een geldig e-mailadres in.'),
});

/** Annuleren-knop die door de sluitpoort van de Modal gaat (useModalSluiten). */
function VuilAnnuleren({ onClose }: { onClose: () => void }) {
  const sluitVia = useModalSluiten();
  return <Button variant="secondary" full onClick={() => sluitVia(onClose)}>Annuleren</Button>;
}
import { Chauffeurkiezer } from '../../components/Chauffeurkiezer';
import { Voertuigkiezer } from '../../components/Voertuigkiezer';

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
const STATUSSEN = ['pending', 'accepted', 'approved', 'rejected', 'cancelled'];
const ACCOUNT_STATUSSEN = ['actief', 'gepauzeerd'];
const RADII = [['md', 'rounded-md'], ['lg', 'rounded-lg'], ['xl', 'rounded-xl'], ['2xl', 'rounded-2xl'], ['3xl', 'rounded-3xl']] as const;
const ICOON_LADDER = [12, 14, 16, 18, 20, 24] as const;

const RIJEN = [
  { id: '1', naam: 'Bart Peeters', dienst: '2601', status: 'approved', geldig: '2025-12-01', dagen: -12 },
  { id: '2', naam: 'An Claes', dienst: '2614', status: 'pending', geldig: '2026-10-10', dagen: 17 },
  { id: '3', naam: 'Tom Wouters', dienst: '2632', status: 'rejected', geldig: '2027-11-27', dagen: 430 },
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
  ['merk', 'Merk'], ['kleur', 'Kleur'], ['typografie', 'Typografie'], ['maat', 'Maat en beweging'], ['knoppen', 'Knoppen'], ['labels', 'Badges en chips'],
  ['kaarten', 'Kaarten'], ['zijvak', 'Zijvak en menu'], ['personen', 'Personen'], ['formulier', 'Formulier'], ['tabel', 'Tabel'], ['feedback', 'Feedback'],
  ['illustraties', 'Lege schermen en meldingen'], ['overlays', 'Overlays'], ['tabs', 'Tabs'], ['meldingsvlak', 'Callout'], ['cijfers', 'Cijfers'], ['lagen', 'Lagen'],
] as const;

const Z_LADDER = [
  ['z-sticky', 10, 'plakkende koppen, vaste kolom'], ['z-sticky-kop', 20, 'plakkende thead'], ['z-sticky-hoek', 25, 'hoekcel'], ['z-laag', 20, 'zwevend in de inhoud'],
  ['z-topbar', 30, 'topbar'], ['z-zwevend', 40, 'popover, dock, scrim zijbalk'], ['z-zijbalk', 50, 'zijbalk'], ['z-menu', 60, 'topbar- en rijmenu'],
  ['z-modal', 100, 'Modal, SlideOver, Sheet'], ['z-dimmer', 110, 'dimmer'], ['z-modal-boven', 120, 'bevestiging boven een modal'], ['z-actiemenu', 125, 'ActieMenu'],
  ['z-toast', 130, 'toast, installatiehint'], ['z-kiezer', 140, 'DatePicker'], ['z-skiplink', 150, 'skip-link'],
] as const;
const ELEVATIE = [['elev-0', 'vlak, alleen haarlijn'], ['elev-pil', 'pil in Segmented'], ['elev-1', 'kaart, tegel, tabel'], ['elev-2', 'popover, menu, dock, toast'], ['elev-3', 'slide-over, sheet'], ['elev-4', 'modal']] as const;

const ILLUSTRATIES = [
  { naam: 'Lege lijst', El: LegeLijst },
  { naam: 'Alles afgehandeld', El: AllesGedaan },
  { naam: 'Geen verbinding', El: GeenBereik },
  { naam: 'Laden mislukt', El: Fout },
  { naam: 'Geen resultaten', El: NietGevonden },
] as const;

async function probeerVoorbeeldOpnieuw() {
  await new Promise<void>((resolve) => setTimeout(resolve, 1200));
  notify('Voorbeeld opnieuw gecontroleerd.', 'success');
}

export function DesignsysteemView() {
  const [aan, setAan] = useState(true);
  const [filter, setFilter] = useState<'alle' | 'open'>('alle');
  const [zoek, setZoek] = useState('');
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());
  const [segment, setSegment] = useState<'vandaag' | 'morgen' | 'week'>('vandaag');
  const [pagina, setPagina] = useState(1);
  const sort = useSort<'naam' | 'dienst'>('naam');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [bevestigOpen, setBevestigOpen] = useState(false);
  const [tab, setTab] = useState<'maand' | 'codes' | 'mensen'>('maand');
  const [uitklap, setUitklap] = useState(false);
  const [zoek2, setZoek2] = useState('');
  // Formulier-demo (tranche 3A): zod-schema + useVeldfouten + Formulier.
  const [demoNaam, setDemoNaam] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const demoFouten = useVeldfouten();
  const demoVerstuur = () => {
    const data = demoFouten.controleer(DEMO_SCHEMA, { naam: demoNaam, email: demoEmail });
    if (data) notify(`Opgeslagen: ${data.naam}.`, 'success');
  };
  const [vuilOpen, setVuilOpen] = useState(false);
  const [vuilTekst, setVuilTekst] = useState('');
  const tabsId = useId();
  const menu = useDropdown();
  const dialoog = useDropdown();
  const [datum, setDatum] = useState('');
  const [periode, setPeriode] = useState({ van: '2026-09-01', tot: '2026-09-30' });
  const [jaar, setJaar] = useState(2026);
  const [chauffeur, setChauffeur] = useState('');
  const [voertuig, setVoertuig] = useState('');

  const rijen = sort.sorteer([...RIJEN], (r, k) => r[k])
    .filter((r) => (filter === 'open' ? r.status === 'pending' : true))
    .filter((r) => r.naam.toLowerCase().includes(zoek.toLowerCase()))
    

  return (
    <PageShell>
      <PageHeader
        view="designsysteem"
        title="Designsysteem"
      />
      <nav aria-label="Inhoud" className="flex flex-wrap gap-2">
        {INHOUD.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="ios-pressable rounded-full border border-hairline bg-paper px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-hairline-strong hover:text-slate-900">
            {label}
          </a>
        ))}
      </nav>

      <Sectie id="merk" titel="Merk" uitleg="Het VHB-logo (pakket VHB primary, 14-09) in zijn drie opmaken, altijd via BrandLogo (inline SVG, carbon uit het pakket, goud = het huisstijl-goud, hard in de component). Sizen op breedte. De laadstand laat een lichtband door de gouden streep trekken; BrandSpinner is dezelfde streep klein.">
        <Rij label="Primary">
          <BrandLogo className="w-56 h-auto" />
          <span className="rounded-xl bg-ink p-4"><BrandLogo tone="donker" className="w-56 h-auto" /></span>
        </Rij>
        <Rij label="Horizontaal">
          <BrandLogo variant="horizontaal" className="w-72 h-auto" />
          <span className="rounded-xl bg-ink p-4"><BrandLogo tone="donker" variant="horizontaal" className="w-72 h-auto" /></span>
        </Rij>
        <Rij label="Beeldmerk">
          <BrandLogo variant="beeldmerk" className="h-6 w-auto" />
          <BrandLogo variant="beeldmerk" className="h-12 w-auto" />
          <span className="rounded-xl bg-ink p-3"><BrandLogo tone="donker" variant="beeldmerk" className="h-12 w-auto" /></span>
        </Rij>
        <Rij label="Laadstand">
          <BrandLogo laden className="w-44 h-auto" />
          <BrandLogo laden variant="beeldmerk" className="h-8 w-auto" />
          <BrandSpinner size={16} />
          <BrandSpinner size={24} />
          <span className="rounded-xl bg-ink p-3"><BrandSpinner size={24} tone="donker" /></span>
        </Rij>
      </Sectie>

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

      <Sectie id="typografie" titel="Typografie" uitleg="Manrope ExtraBold (800) voor koppen, Inter voor de rest. Ladder 11 · 12 · 13 · 15 · 16 · 18 · 24 · 30; koppen 17/20/30 alleen via hun rol. Geen losse tekstmaten in views.">
        <div className="space-y-3">
          <p className="text-page-title">Paginatitel · text-page-title · 24/30, -0.02/-0.025em</p>
          <p className="text-section-title">Sectietitel · text-section-title · 18/20, -0.01/-0.015em</p>
          <p className="text-card-title">Kaarttitel · text-card-title · 17, -0.01em</p>
          <p className="text-body text-slate-600">Lopende tekst · text-body 15/1.55, De dienst begint om 05:42 aan de stelplaats; de eerste rit vertrekt tien minuten later.</p>
          <p className="text-body-sm text-slate-500">Compacte lopende tekst · text-body-sm 13/1.55, hint onder een veld, zijvak-voet of tooltip.</p>
          <p className="text-md text-slate-800">Lijst- en detailtekst · text-md 15, rijtitel in een kaart of lijst.</p>
          <p className="text-sm text-slate-600">UI-laag · text-sm 13, chips, knoppen, tabelcellen, labels.</p>
          <p className="text-xs text-slate-500">Meta · text-xs 12, datum, teller-tekst, dichte tabel.</p>
          <p className="text-label">Label · text-label</p>
          <p className="text-micro">Micro · text-micro · 11, samen met badges en tellers de enige 2xs</p>
          <p className="text-stat text-slate-900">2116 · text-stat</p>
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
        <Rij label="Bezig">
          <Button variant="primary" size="sm" icon={<Plus size={16} />} bezig>Opslaan</Button>
          <Button variant="secondary" size="sm" iconRechts={<Download size={16} />} bezig>Exporteren</Button>
          <Button variant="secondary" size="sm" bezig>Zonder icoon</Button>
        </Rij>
        <Rij label="Segmented">
          <Segmented<'vandaag' | 'morgen' | 'week'> waarde={segment} opties={[{ waarde: 'vandaag', label: 'Vandaag' }, { waarde: 'morgen', label: 'Morgen' }, { waarde: 'week', label: 'Week' }]} onChange={setSegment} label="Periode kiezen" />
        </Rij>
        <Rij label="Meter">
          <Meter className="h-1.5 w-40"><MeterVulling pct={35} className="bg-emerald-500" /></Meter>
          <Meter className="h-1.5 w-40"><MeterVulling pct={80} className="bg-oker-500" /></Meter>
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
          <FilterChip active={false} tone="amber">Buiten België: 1</FilterChip>
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
        <Rij label="StatusBadge map">{ACCOUNT_STATUSSEN.map((s) => <StatusBadge key={s} status={s} map={ACCOUNT_STATUS} />)}</Rij>
        <Rij label="De Lijn · klein"><LijnTegel line="50, 801, 858, 871, 872, 883, 884" size="sm" layout="rij" /></Rij>
        <Rij label="De Lijn · groot"><LijnTegel line="50, 801, 858, 871, 872, 883, 884" layout="rij" /></Rij>
        <Rij label="Overige lijnen"><LijnTegel line="58, X20" size="sm" layout="rij" tone="muted" /><LijnTegel line="Alle" size="sm" /></Rij>
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

      <Sectie id="zijvak" titel="Zijvak en actiemenu" uitleg="Zijvak: het vaste rechtervak naast een enkelkolomscherm (cijfers, laatste wijziging, hulp), gedempt, sticky. ActieMenu: secundaire acties achter '…', zodat een scherm één gouden knop houdt.">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_20rem]">
          <Card padding="sm" className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Hoofdinhoud met één primaire actie en de rest in het menu.</p>
            <span className="flex items-center gap-2">
              <Button variant="primary" size="sm"><Plus size={16} />Nieuw</Button>
              <ActieMenu size="sm" items={[
                { label: 'Excel importeren', icon: <Download size={16} />, onClick: () => notify('Excel importeren', 'info') },
                { label: 'CSV downloaden', icon: <Download size={16} />, onClick: () => notify('CSV downloaden', 'info') },
                { label: 'Verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, onClick: () => notify('Verwijderd', 'info') },
              ]} />
            </span>
          </Card>
          <Zijvak titel="Deze maand" voet={<ZijvakTekst>Cijfers volgen de geladen planning.</ZijvakTekst>}>
            <ZijvakRij label="Dagen met gaten" waarde="3" mono />
            <ZijvakRij label="Open diensten" waarde="4" mono />
            <ZijvakRij label="Laatste import" waarde="zo 30 aug" />
          </Zijvak>
        </div>
      </Sectie>

      <Sectie id="personen" titel="Personen" uitleg="Avatar met initialen en een vaste, gedempte tint per naam, zodat lijsten scanbaar worden zonder extra kleur. De ingelogde gebruiker in de topbar blijft goud.">
        <Rij label="Maten">
          <Avatar naam="Bart Peeters" size="sm" />
          <Avatar naam="Bart Peeters" size="md" />
          <Avatar naam="Bart Peeters" size="lg" />
        </Rij>
        <Rij label="Tinten">
          {['An Claes', 'Tom Wouters', 'Els Maes', 'Jef Janssens', 'Mia De Smet', 'Koen Vermeulen', 'Sara Willems', 'Dries Peeters'].map((naam) => (
            <span key={naam} className="inline-flex items-center gap-2 text-sm text-slate-700"><Avatar naam={naam} size="md" naamZichtbaar />{naam}</span>
          ))}
        </Rij>
      </Sectie>

      <Sectie id="formulier" titel="Formulier" uitleg="Formulier is een echte <form>: Enter dient in en de focus gaat naar het eerste ongeldige veld. Field zorgt voor label, hint en fout; Input, Select, Textarea en DateInput erven id, aria-describedby en invalid vanzelf. Validatie via useVeldfouten met het gedeelde zod-schema; fouten staan bij het veld, nooit in een toast.">
        <Formulier onVerstuur={demoVerstuur} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Naam" required hint="Voornaam en achternaam." error={demoFouten.fouten.naam}>
              <Input value={demoNaam} onChange={(e) => { setDemoNaam(e.target.value); demoFouten.wisVeld('naam'); }} placeholder="Bart Peeters" />
            </Field>
            <Field label="E-mailadres" required error={demoFouten.fouten.email}>
              <Input type="email" value={demoEmail} onChange={(e) => { setDemoEmail(e.target.value); demoFouten.wisVeld('email'); }} placeholder="bart@vhb.be" />
            </Field>
            <Field label="Rol">
              <Select defaultValue="chauffeur">
                <option value="chauffeur">Chauffeur</option>
                <option value="planner">Planner</option>
                <option value="admin">Beheerder</option>
              </Select>
            </Field>
            <Field label="Startdatum" hint="Eén datumkiezer voor alle velden; op mobiel een sheet onderaan.">
              <DateInput value={datum} onChange={setDatum} min="2026-01-01" />
            </Field>
            <Field label="Opmerking" hint="Optioneel.">
              <Textarea rows={2} placeholder="Korte toelichting…" />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary">Opslaan (of Enter)</Button>
            <Button variant="secondary" onClick={() => { setDemoNaam(''); setDemoEmail(''); demoFouten.wis(); }}>Leegmaken</Button>
            <span className="text-body-sm text-slate-500">Leeg laten en indienen: de focus springt naar het eerste veld met een fout.</span>
          </div>
        </Formulier>
        <Rij label="Checkbox">
          <Checkbox checked={aan} onChange={setAan} label="Ik ga akkoord" />
          <Checkbox checked={false} indeterminate onChange={() => {}} label="Gedeeltelijk" />
        </Rij>
        <Rij label="Onbewaarde invoer">
          <Button variant="secondary" onClick={() => setVuilOpen(true)}>Modal met dirty-bescherming</Button>
          <span className="text-body-sm text-slate-500">Typ iets en sluit met Escape, de backdrop of het kruisje: eerst “Wijzigingen niet bewaren?”.</span>
        </Rij>
        <Rij label="Foutcopy met vervolgstap">
          <Button variant="secondary" onClick={() => meldSchrijffout('Opslaan', new TypeError('Failed to fetch'), () => notify('Opnieuw geprobeerd.', 'info'))}>Netwerkfout</Button>
          <Button variant="secondary" onClick={() => meldSchrijffout('Verwijderen', Object.assign(new Error('Je bent geen beheerder van deze lijst'), { status: 403 }))}>Geen rechten (403)</Button>
          <Button variant="secondary" onClick={() => meldSchrijffout('Bewaren')}>Onbekende oorzaak</Button>
        </Rij>
        <Modal open={vuilOpen} onClose={() => { setVuilOpen(false); setVuilTekst(''); }} vuil={vuilTekst !== ''} maxWidth="sm" ariaLabel="Notitie">
          <ModalHeader title="Notitie" description="Sluiten met tekst in het veld vraagt eerst bevestiging." onClose={() => { setVuilOpen(false); setVuilTekst(''); }} />
          <div className="space-y-4 p-6">
            <Field label="Tekst">
              <Textarea rows={3} value={vuilTekst} onChange={(e) => setVuilTekst(e.target.value)} placeholder="Typ iets…" />
            </Field>
            <VuilAnnuleren onClose={() => { setVuilOpen(false); setVuilTekst(''); }} />
          </div>
        </Modal>
      </Sectie>

      <Sectie id="rapportfilters" titel="Rapportfilters" uitleg="De filterbouwstenen van de pagina Rapporten, ook los bruikbaar: Periodekiezer (snelkeuze plus de twee datums, zone-loze ISO), JaarKiezer, Chauffeurkiezer en Voertuigkiezer (Select met Alle, gesorteerd, wie uit dienst is in een eigen groep). De tabel en het blad erbij zijn RapportTabel en PrintBlad.">
        <Periodekiezer waarde={periode} onChange={setPeriode} vandaag="2026-09-15" />
        <div className="grid gap-4 sm:grid-cols-3">
          <JaarKiezer waarde={jaar} onChange={setJaar} huidigJaar={2026} />
          <Chauffeurkiezer
            users={[{ id: '1', name: 'Bart Peeters' }, { id: '2', name: 'An Claes' }, { id: '3', name: 'Tom Wouters', isActive: false }]}
            waarde={chauffeur}
            onChange={setChauffeur}
          />
          <Voertuigkiezer
            voertuigen={[{ id: 'v1', busnr: '5226', kortNr: 26, status: 'actief' }, { id: 'v2', busnr: '5231', kortNr: 31, status: 'actief' }, { id: 'v3', busnr: '4410', kortNr: 10, status: 'verkocht' }]}
            waarde={voertuig}
            onChange={setVoertuig}
          />
        </div>
      </Sectie>

      <Sectie id="lijstrij" titel="Lijstrij" uitleg="Het rijrecept voor lijsten met records: één LijstKaart met hairlines in plaats van losse kaarten, en per RecordRij de titel alleen op regel 1, meta links en status rechts op regel 2, en één chevron (omlaag = klapt open, rechts = opent een detail). Een gouden streep = nieuw voor jou, een rode = dringend, nooit een getint vlak.">
        <div className="max-w-md">
          <LijstKaart aria-label="Voorbeeld van het rijrecept">
            <RecordRij titel="01/09 – 05/09/2026" meta="Betaald verlof · 5 dagen" status={<><Badge tone="oker">Nieuw</Badge><StatusBadge status="approved" stil /></>} accent="nieuw" richting="omlaag" onClick={() => {}} />
            <RecordRij titel="Onderhoud aan boordcomputers" meta="27 jul 2026" status={<Badge tone="red" dot>Dringend</Badge>} voorproef="Alle bussen krijgen dit weekend een software-update." accent="dringend" richting="rechts" onClick={() => {}} />
            <RecordRij titel="Do 24 september" meta="Dienst 2101" status={<StatusBadge status="pending" stil />} richting="omlaag" onClick={() => {}} />
          </LijstKaart>
        </div>
      </Sectie>

      <Sectie id="tabel" titel="Tabel" uitleg="TableShell is het kader: label (toegankelijke naam), kop (toolbar, filters, bulkbalk) en de overloop (standaard schuiven, sticky vanaf xl, past = de kop plakt altijd). Tabel is de table erin, Th is standaard een kolomkop (scope col). Een rij die iets opent draagt een CelKnop in de hoofdcel (Tab en Enter werken) en rijKlik op de rij als muisgemak, geen apart potlood. Td num = cijfer rechts, Td nowrap = datum, tijd of code op één regel. Op de telefoon (onder md) een kaartlijst, geen verkleinde tabel.">
        <TableShell
          label="Voorbeeldtabel"
          past
          kop={(
            <div className="space-y-2.5">
              <TableToolbar
                zoek={zoek}
                onZoek={setZoek}
                placeholder="Zoek op naam…"
                telling={`${rijen.length} van ${RIJEN.length}`}
                filters={<><FilterChip active={filter === 'alle'} onClick={() => setFilter('alle')}>Alle</FilterChip><FilterChip active={filter === 'open'} onClick={() => setFilter('open')}>Open</FilterChip></>}
                acties={<Button variant="primary" size="sm"><Plus size={16} />Nieuw</Button>}
              />
              <BulkBar aantal={gekozen.size} onWis={() => setGekozen(new Set())}>
                <Button variant="secondary" size="sm">Exporteren</Button>
                <Button variant="danger" size="sm">Verwijderen</Button>
              </BulkBar>
            </div>
          )}
        >
          <Tabel>
            <StickyThead>
              <tr>
                <Th className="w-10"><Checkbox checked={gekozen.size === rijen.length && rijen.length > 0} indeterminate={gekozen.size > 0 && gekozen.size < rijen.length} onChange={(v) => setGekozen(v ? new Set(rijen.map((r) => r.id)) : new Set())} label="Alles selecteren" /></Th>
                <SortTh kolom="naam" sort={sort}>Naam</SortTh>
                <SortTh kolom="dienst" sort={sort} align="right">Dienst</SortTh>
                <Th>Geldig tot</Th>
                <Th>Status</Th>
              </tr>
            </StickyThead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.id} onClick={rijKlik(() => notify(`${r.naam} geopend.`, 'success'))} className="cursor-pointer border-t border-hairline-subtle transition-colors hover:bg-surface-soft-hover">
                  <Td><Checkbox checked={gekozen.has(r.id)} onChange={(v) => setGekozen((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} label={`Selecteer ${r.naam}`} /></Td>
                  <Td><CelKnop onClick={() => notify(`${r.naam} geopend.`, 'success')} label={`${r.naam} openen`} className="font-semibold text-slate-800">{r.naam}</CelKnop></Td>
                  <Td num><Chip>{r.dienst}</Chip></Td>
                  <Td nowrap><VervalPil datum={r.geldig} dagen={r.dagen} /></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </TableShell>
        <Paginering totaal={48} perPagina={20} pagina={pagina} onPagina={setPagina} />
        <Rij label="VervalPil">
          <VervalPil datum="2025-12-01" dagen={-12} />
          <VervalPil datum="2026-10-10" dagen={17} />
          <VervalPil datum="2026-12-01" dagen={69} />
          <VervalPil datum="2027-11-27" dagen={430} />
          <VervalPil datum={null} label="Code 95" />
        </Rij>
      </Sectie>

      <Sectie id="feedback" titel="Feedback" uitleg="Laadindicatoren, de laatste ververstijd en korte bevestigingen bij een actie.">
        <Rij label="Skeleton">
          <div className="w-full space-y-2"><SkeletonRow /><SkeletonRow /></div>
          <SkeletonTile className="w-40" />
          <Skeleton className="h-4 w-32" />
        </Rij>
        <Rij label="Versheid">
          <span className="rounded-lg bg-surface-muted px-2.5 py-1"><VersheidRegel laatstGeladen={Date.now()} verversen={false} online /></span>
          <span className="rounded-lg bg-surface-muted px-2.5 py-1"><VersheidRegel laatstGeladen={Date.now()} verversen online /></span>
          <span className="rounded-lg bg-surface-muted px-2.5 py-1"><VersheidRegel laatstGeladen={Date.now()} verversen={false} online={false} /></span>
        </Rij>
        <Rij label="Toast">
          <Button variant="secondary" size="sm" onClick={() => notify('Opgeslagen.', 'success')}>Succes</Button>
          <Button variant="secondary" size="sm" onClick={() => notify('Dat is niet gelukt. Probeer opnieuw.', 'error')}>Fout</Button>
          <Button variant="secondary" size="sm" onClick={() => notify('Even geduld, de import loopt.', 'info')}>Info</Button>
          <Button variant="secondary" size="sm" onClick={() => notify('Omleiding ‘Lijn 12 · Werken Stationsstraat’ verwijderd.', 'info', { action: { label: 'Ongedaan maken', run: () => notify('Omleiding hersteld.', 'success') }, opties: { ongedaan: true } })}>Ongedaan maken</Button>
        </Rij>
      </Sectie>

      <Sectie id="overlays" titel="Overlays" uitleg="Eén vlak per situatie. Popover: klein vlak onder een knop (menu of uitleg). Tooltip: hover-uitleg bij een aanwijzer. Sheet: keuze of kort formulier onder de duim, veeg omlaag sluit. Modal: beslissing of formulier midden in beeld. ConfirmationModal: één vraag bovenop een modal. Allemaal veer in, ease uit, focus terug naar de knop.">
        <Rij label="Popover · menu">
          <div ref={menu.wortel} className="relative inline-flex">
            <Button variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={menu.open} onClick={() => menu.setOpen((v) => !v)}>Account</Button>
            <Popover open={menu.open} rol="menu" label="Account" align="left" breedte="md">
              <PopoverKop titel="Jarno De Greve" aside={<Badge tone="slate">Admin</Badge>} />
              <MenuItem icon={<Settings size={16} />} onClick={() => menu.setOpen(false)}>Instellingen</MenuItem>
              <MenuItem icon={<Bell size={16} />} sub="3 ongelezen" onClick={() => menu.setOpen(false)}>Meldingen</MenuItem>
              <MenuItem icon={<LogOut size={16} />} gevaarlijk onClick={() => menu.setOpen(false)}>Uitloggen</MenuItem>
              <PopoverVoet><MenuItem icon={<ArrowUpRight size={16} />} onClick={() => menu.setOpen(false)}>Volledig overzicht</MenuItem></PopoverVoet>
            </Popover>
          </div>
          <div ref={dialoog.wortel} className="relative inline-flex">
            <IconButton label="Uitleg" variant="secondary" size="sm" aria-haspopup="dialog" aria-expanded={dialoog.open} onClick={() => dialoog.setOpen((v) => !v)}><Info size={16} /></IconButton>
            <Popover open={dialoog.open} label="Uitleg" align="left" breedte="lg" padding="tekst" className="text-body-sm text-slate-600">
              Een popover met lopende tekst: <Kbd>Esc</Kbd> sluit, buiten klikken ook.
            </Popover>
          </div>
        </Rij>
        <Rij label="Tooltip">
          <Tooltip label="Bewerken"><IconButton label="Bewerken" variant="secondary" size="sm"><Pencil size={16} /></IconButton></Tooltip>
          <Tooltip label="Verwijderen" kant="onder"><IconButton label="Verwijderen" variant="danger" size="sm"><Trash2 size={16} /></IconButton></Tooltip>
          <span className="text-body-sm text-slate-500">alleen bij een aanwijzer of toetsenbordfocus; op touch draagt het aria-label</span>
        </Rij>
        <Rij label="Sheet · Modal">
          <Button variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>Sheet openen</Button>
          <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>Modal openen</Button>
          <Button variant="danger" size="sm" onClick={() => setBevestigOpen(true)}>Bevestiging</Button>
        </Rij>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Dienst 2101" subtitle="di 22 september" footer={<Button variant="primary" full onClick={() => setSheetOpen(false)}>Ritblad openen</Button>}>
          <p className="text-body text-slate-600">Een sheet komt van onder, past onder de duim en sluit met een veeg omlaag, het kruisje, Escape of de terugknop.</p>
        </Sheet>
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" ariaLabel="Voorbeeldmodal">
          <ModalHeader title="Voorbeeldmodal" description="Beslissing of formulier midden in beeld." onClose={() => setModalOpen(false)} />
          <div className="p-6"><Button variant="primary" onClick={() => setModalOpen(false)}>Sluiten</Button></div>
        </Modal>
        <ConfirmationModal open={bevestigOpen} onClose={() => setBevestigOpen(false)} onConfirm={() => notify('Voorbeeld verwijderd.', 'info')} title="Voorbeeld verwijderen?" message="Dit is een voorbeeld, er verdwijnt niets." />
      </Sectie>

      <Sectie id="tabs" titel="Tabs en uitklappen" uitleg="Tabs wisselen de inhoud eronder (tablist/tab/tabpanel, pijltjes, neutrale onderstreep); Segmented kiest één waarde in een filter of formulier. Uitklap opent inhoud onder een rij zonder sprong.">
        <div className="w-full max-w-lg space-y-3">
          <Tabs id={tabsId} waarde={tab} opties={[{ waarde: 'maand', label: 'Maand' }, { waarde: 'codes', label: 'Looncodes', teller: 4 }, { waarde: 'mensen', label: 'Medewerkers' }]} onChange={setTab} label="Onderdeel" />
          <TabPaneel tabsId={tabsId} waarde="maand" actief={tab === 'maand'}><p className="text-body-sm text-slate-600">Inhoud van het tabblad Maand.</p></TabPaneel>
          <TabPaneel tabsId={tabsId} waarde="codes" actief={tab === 'codes'}><p className="text-body-sm text-slate-600">Vier looncodes.</p></TabPaneel>
          <TabPaneel tabsId={tabsId} waarde="mensen" actief={tab === 'mensen'}><p className="text-body-sm text-slate-600">Medewerkers.</p></TabPaneel>
        </div>
        <div className="w-full max-w-lg">
          <Card padding="none">
            <Pressable className="flex w-full items-center justify-between px-4 py-3" aria-expanded={uitklap} onClick={() => setUitklap((v) => !v)}>
              <span className="text-row-title">Uitklapbare rij (Pressable)</span>
              <ChevronDown size={16} className={uitklapChevron(uitklap, 180, 'text-slate-500')} />
            </Pressable>
            <Uitklap open={uitklap} innerClassName="px-4 pb-4 text-body-sm text-slate-600">Pressable is de basis voor elke rij of tegel die zelf zijn opmaak draagt: pressed-staat en focusring zonder knop-look.</Uitklap>
          </Card>
        </div>
        <Rij label="SearchField">
          <SearchField value={zoek2} onChange={setZoek2} placeholder="Zoek chauffeur…" className="w-72" />
          <SearchField value="2101" onChange={() => {}} placeholder="Met waarde" size="sm" className="w-56" />
        </Rij>
        <Rij label="Kbd"><Kbd>Esc</Kbd><Kbd>↑</Kbd><Kbd>Enter</Kbd></Rij>
      </Sectie>

      <Sectie id="meldingsvlak" titel="Callout" uitleg="Eén meldingsvlak in de inhoud: icoon, titel, tekst en één actie, in de vijf tinten van Card. Compact = één regel. Geen live-rol tenzij het vlak verschijnt door een actie.">
        <div className="w-full space-y-3">
          <Callout tone="warning" compact action={<Button variant="secondary" size="sm">Opnieuw</Button>}>Offline, wijzigingen komen niet door.</Callout>
          <Callout tone="danger" title="Gevarenzone" action={<Button variant="danger" size="sm" icon={<Trash2 size={14} />}>Planning wissen</Button>}>Wis alle actieve roosterregels uit het portaal.</Callout>
          <Callout tone="info" title="Nieuw in deze versie">Rapporten hebben nu een peildatum.</Callout>
          <Callout tone="success" compact>Import geslaagd, 1 349 diensten.</Callout>
          <Callout tone="accent" compact>Welkom terug, je volgende dienst is morgen om 05:12.</Callout>
        </div>
      </Sectie>

      <Sectie id="cijfers" titel="Cijfers" uitleg="Stat: het neutrale cijferblok (label, cijfer in text-stat, toelichting) voor een samenvatting of historiek. OpsStat: de cockpit-tegel met icoon en tint, in kpi-raster op de telefoon één kaart met rijen.">
        <div className="grid w-full gap-3 sm:grid-cols-4">
          <Stat label="Dagen" value={56} />
          <Stat label="Diensten" value="1 349" sub="in 56 dagen" />
          <Stat label="Langste dienst" value="10:35" mono sub="dienst 2607" />
          <Stat label="Verlopen" value={3} aandacht sub="nog in te vullen" />
        </div>
        <div className="kpi-raster grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          <OpsStat icon={<Bus size={16} />} tone="slate" label="Chauffeurs actief" value={7} sub="nu aan het rijden" />
          <OpsStat icon={<Bell size={16} />} tone="oker" label="Verlof" value={1} sub="wacht op een beslissing" />
          <OpsStat icon={<Check size={16} />} tone="blue" label="Beschikbaar" value={2} sub="vrij en inzetbaar" />
        </div>
      </Sectie>

      <Sectie id="lagen" titel="Lagen" uitleg="Twee ladders: elevation (schaduw en rand per oppervlak, tokens --elev-0…4) en z (welke laag boven welke ligt, utilities z-sticky … z-skiplink). Nieuwe overlay = een trede uit deze tabel, geen eigen getal.">
        <Rij label="Elevation">
          {ELEVATIE.map(([klasse, uitleg]) => (
            <div key={klasse} className={`flex h-16 w-36 flex-col justify-center rounded-2xl bg-paper px-3 ring-1 ring-hairline ${klasse}`}>
              <span className="text-xs font-semibold text-slate-800">{klasse}</span>
              <span className="text-xs text-slate-500">{uitleg}</span>
            </div>
          ))}
        </Rij>
        <TableShell label="Z-ladder">
          <Tabel>
            <thead><tr><Th>Utility</Th><Th num>z</Th><Th>Voor</Th></tr></thead>
            <tbody>
              {Z_LADDER.map(([klasse, z, uitleg]) => (
                <tr key={klasse} className="border-t border-hairline-subtle"><Td><Chip>{klasse}</Chip></Td><Td num>{z}</Td><Td className="text-sm text-slate-600">{uitleg}</Td></tr>
              ))}
            </tbody>
          </Tabel>
        </TableShell>
      </Sectie>

      <Sectie id="illustraties" titel="Lege schermen & meldingen" uitleg="Duidelijke status. Een logische volgende stap.">
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 py-4 sm:grid-cols-3 lg:grid-cols-5">
          {ILLUSTRATIES.map(({ naam, El }) => (
            <div key={naam} className="flex min-w-0 flex-col items-center gap-3 text-center">
              <El className="h-20 w-20" />
              <p className="text-body-sm font-medium text-slate-800">{naam}</p>
            </div>
          ))}
        </div>
        <div className="space-y-4 border-t border-hairline pt-5">
          <MicroLabel>In gebruik</MicroLabel>
          <div className="grid gap-4 lg:grid-cols-3">
            <EmptyState title="Nog geen omleidingen" message="Voeg een omleiding toe. Chauffeurs zien die op Mijn dag." action={<Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => notify('Voorbeeld: hier voeg je een omleiding toe.', 'info')}>Omleiding toevoegen</Button>} />
            <EmptyState variant="klaar" title="Alles afgehandeld" message="Er staan geen aanvragen meer open." />
            <Foutkaart titel="De gele boek kon niet laden" boodschap="Probeer het over enkele ogenblikken opnieuw." onOpnieuw={probeerVoorbeeldOpnieuw} />
          </div>
        </div>
        <div className="space-y-3 pt-2">
          <p className="text-body-sm text-slate-500">Compacte meldingen</p>
          <Foutkaart compact boodschap="De vervaldata konden niet worden vernieuwd." onOpnieuw={probeerVoorbeeldOpnieuw} />
          <EmptyState compact illustratie={<NietGevonden />} title="Geen resultaten" message="Pas je zoekopdracht of filters aan." />
        </div>
      </Sectie>
    </PageShell>
  );
}
