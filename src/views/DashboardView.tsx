import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Calendar, Clock, MapPin, ChevronRight, ArrowUpRight } from 'lucide-react';
import type { Diversion, Shift, User } from '../types';
import { useCursorGlow, getDaypartGreeting } from '../lib/interactive';
import { Sparkline } from '../components/Sparkline';
import { BrandEmptyState } from '../components/BrandEmptyState';

/**
 * Dashboard — Bento premium-stijl (E++ preview).
 *
 * Verfijningen vs. eerste bento-versie:
 * - Asymmetrische tegel-groottes (hero span 2-col + 2 smaller)
 * - Diepere lagen schaduw (basis + colored glow on hover)
 * - 2-tone iconen: chip-achtergrond + crisp foreground
 * - Sterker typografisch contrast (label-size klein, value-size groot)
 * - Inner highlight via inset shadows (premium glas-gevoel)
 * - Smooth hover-transitions (scale + shadow + ring)
 */
export function DashboardView({
  user,
  shifts,
  diversions,
  users,
}: {
  user: User;
  shifts: Shift[];
  diversions: Diversion[];
  users: User[];
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter((s) => s.driverId === user.id);
  const today = now.toISOString().split('T')[0];
  const todaysShift = myShifts.find((shift) => shift.date === today);

  const nextShift = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];

  const newestDiversions = [...diversions].reverse().slice(0, 3);
  const visibleShifts = myShifts.slice(0, 3);

  const formatShiftDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });

  const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

  const getCountdown = (target: Date) => {
    const diff = target.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) return `${Math.floor(hours / 24)} dagen`;
    if (hours > 0) return `${hours}u ${minutes}m`;
    return `${minutes} minuten`;
  };

  const isChauffeur = user.role === 'chauffeur';
  const firstName = user.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);

  return (
    <div className="space-y-4">
      {/* === Gepersonaliseerde begroeting === */}
      <div className="px-1 pt-1">
        <h1 className="text-2xl md:text-3xl font-black tracking-[-0.03em] text-slate-900">
          {greeting}, <span className="text-oker-600">{firstName}</span>
        </h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          {now.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
          {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* === HERO ROW === */}
      {isChauffeur && nextShift ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Hero: spans 2 cols op desktop */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="tilt-card glow-top glass-stack lg:col-span-2 relative overflow-hidden rounded-[28px] p-6 md:p-8"
            style={{
              background:
                'linear-gradient(135deg, rgba(255, 251, 235, 0.78) 0%, rgba(254, 243, 199, 0.62) 60%, rgba(253, 230, 138, 0.42) 100%)',
              backdropFilter: 'blur(32px) saturate(160%)',
              WebkitBackdropFilter: 'blur(32px) saturate(160%)',
              border: '1px solid rgba(255, 255, 255, 0.8)',
              boxShadow:
                'inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(255, 255, 255, 0.3), 0 12px 32px rgba(245, 158, 11, 0.12), 0 4px 12px rgba(245, 158, 11, 0.08)',
            }}
          >
            <div
              className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-50"
              style={{
                background: 'radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, transparent 70%)',
              }}
            />
            <div
              className="pointer-events-none absolute -bottom-24 -left-24 w-64 h-64 rounded-full opacity-30"
              style={{
                background: 'radial-gradient(circle, rgba(245, 158, 11, 0.18) 0%, transparent 70%)',
              }}
            />

            <div className="relative">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-white/65 backdrop-blur-md ring-1 ring-white/70 rounded-full mb-4">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-oker-500 opacity-70 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-oker-500" />
                </span>
                <span className="text-[10px] font-black text-oker-800 uppercase tracking-[0.18em]">
                  Volgende dienst
                </span>
              </div>

              <h2 className="text-5xl md:text-6xl font-black tracking-[-0.04em] text-slate-900 leading-none">
                {getCountdown(nextShift.startDateTime)}
              </h2>
              <p className="mt-2 text-sm font-semibold text-slate-700/80">
                {nextShift.startDateTime.toLocaleDateString('nl-BE', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
                {' · dienst '}
                {getServiceNumber(nextShift)}
              </p>

              <div className="mt-5 flex gap-2.5">
                <div className="bg-white/70 backdrop-blur-md rounded-2xl px-4 py-2.5 ring-1 ring-white/80 shadow-sm">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Start</p>
                  <p className="text-2xl font-black text-slate-900 tabular-nums leading-none">{nextShift.startTime}</p>
                </div>
                <div className="bg-white/70 backdrop-blur-md rounded-2xl px-4 py-2.5 ring-1 ring-white/80 shadow-sm">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Einde</p>
                  <p className="text-2xl font-black text-slate-900 tabular-nums leading-none">{nextShift.endTime}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right column: 2 stacked smaller tiles */}
          <div className="flex flex-col gap-4">
            <StatTile
              icon={<Clock size={18} />}
              color="emerald"
              label="Vandaag"
              value={todaysShift?.startTime || 'Vrij'}
              subValue={todaysShift ? `tot ${todaysShift.endTime}` : 'Geen dienst'}
            />
            <StatTile
              icon={<AlertTriangle size={18} />}
              color="rose"
              label="Omleidingen"
              value={diversions.length}
              subValue="Actief in netwerk"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <StatTile
            icon={<Clock size={18} />}
            color="emerald"
            label="Vandaag"
            value={todaysShift?.startTime || 'Vrij'}
            subValue={todaysShift ? `tot ${todaysShift.endTime}` : 'Geen dienst gepland'}
          />
          <StatTile
            icon={<AlertTriangle size={18} />}
            color="rose"
            label="Omleidingen"
            value={diversions.length}
            subValue="Actief in netwerk"
          />
        </div>
      )}

      {/* === Wide tiles row === */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PremiumPanel icon={<Calendar size={16} />} iconBg="bg-slate-900" title="Planning" subtitle={now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'long' })}>
          {visibleShifts.length > 0 ? (
            <div className="space-y-2">
              {visibleShifts.map((shift) => (
                <div key={shift.id} className="group flex items-center justify-between gap-3 rounded-2xl bg-white/70 ring-1 ring-slate-200/60 px-3.5 py-2.5 hover:bg-white hover:ring-slate-300/80 hover:shadow-sm transition-all">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{formatShiftDate(shift.date)}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-oker-700">Dienst {getServiceNumber(shift)}</span>
                    </div>
                    <p className="mt-0.5 text-base font-black text-slate-900 tabular-nums tracking-tight">
                      {shift.startTime} <span className="text-slate-400 font-bold">–</span> {shift.endTime}
                    </p>
                  </div>
                  {!isChauffeur && (
                    <span className="text-xs text-slate-500 truncate font-semibold max-w-[120px]">
                      {users.find((u) => u.id === shift.driverId)?.name || 'Onbekend'}
                    </span>
                  )}
                  <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <BrandEmptyState title="Geen dienst vandaag" message="Geniet van je vrije dag." />
          )}
        </PremiumPanel>

        <PremiumPanel icon={<AlertTriangle size={16} />} iconBg="bg-oker-500" title="Omleidingen" subtitle={`${newestDiversions.length} actief`} accent="oker">
          {newestDiversions.length > 0 ? (
            <div className="space-y-2">
              {newestDiversions.map((div) => (
                <div key={div.id} className="group flex items-start gap-3 rounded-2xl bg-white/70 ring-1 ring-oker-200/40 px-3.5 py-2.5 hover:bg-white hover:ring-oker-300/60 hover:shadow-sm transition-all cursor-pointer">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-oker-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-slate-900 truncate">{div.title}</p>
                      <span className="shrink-0 inline-block rounded-md bg-oker-500/15 px-1.5 py-0.5 text-[10px] font-black text-oker-800">{div.line}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-slate-600/80 line-clamp-2">{div.description}</p>
                  </div>
                  <ArrowUpRight size={14} className="text-oker-400 group-hover:text-oker-700 transition-colors shrink-0 mt-1" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyTile icon={<MapPin size={20} />} title="Geen actieve hinder" subtitle="Geen omleidingen geregistreerd." />
          )}
        </PremiumPanel>
      </div>
    </div>
  );
}

// === Subcomponents ===

// Rustige glass palette: glas-tegels met heel licht kleur-zweem.
// backdrop-filter geeft het "Apple Wallet kaart"-glas-effect — witten zijn
// iets minder dekkend zodat de background door het glas heen schijnt.
const TILE_PALETTE = {
  emerald: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.68) 0%, rgba(240, 253, 244, 0.55) 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4), 0 8px 24px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(16, 185, 129, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.85)',
    iconBg: 'bg-emerald-500',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  rose: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.68) 0%, rgba(255, 241, 242, 0.55) 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4), 0 8px 24px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(244, 63, 94, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.85)',
    iconBg: 'bg-rose-400',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  oker: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.68) 0%, rgba(255, 251, 235, 0.6) 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4), 0 8px 24px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(245, 158, 11, 0.10)',
    border: '1px solid rgba(255, 255, 255, 0.85)',
    iconBg: 'bg-oker-500',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  blue: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.68) 0%, rgba(239, 246, 255, 0.55) 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4), 0 8px 24px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(59, 130, 246, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.85)',
    iconBg: 'bg-blue-400',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
  slate: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.68) 0%, rgba(248, 250, 252, 0.55) 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.4), 0 6px 20px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.85)',
    iconBg: 'bg-slate-700',
    text: 'text-slate-900',
    sub: 'text-slate-500',
  },
} as const;

export type TilePalette = keyof typeof TILE_PALETTE;

export function StatTile({
  icon,
  color,
  label,
  value,
  subValue,
  onClick,
  sparkline,
  sparklineColor,
}: {
  icon: ReactNode;
  color: TilePalette;
  label: string;
  value: string | number;
  subValue?: string;
  onClick?: () => void;
  sparkline?: number[];
  sparklineColor?: string;
}) {
  const c = TILE_PALETTE[color];
  // Default sparkline-kleur volgt de accent-tint
  const splColor =
    sparklineColor ||
    (color === 'oker'
      ? '#d97706'
      : color === 'rose'
      ? '#e11d48'
      : color === 'emerald'
      ? '#059669'
      : color === 'blue'
      ? '#2563eb'
      : '#475569');
  const Body = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${c.iconBg} text-white shadow-md shadow-black/10`}>
          {icon}
        </div>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline data={sparkline} width={64} height={22} color={splColor} />
        ) : (
          onClick && <ArrowUpRight size={14} className={`${c.sub} opacity-70`} />
        )}
      </div>
      <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${c.sub}`}>{label}</p>
      <p className={`mt-1 text-3xl font-black tabular-nums tracking-[-0.03em] ${c.text}`}>{value}</p>
      {subValue && <p className={`mt-1 text-xs font-semibold ${c.sub}`}>{subValue}</p>}
    </>
  );
  const tileStyle = {
    background: c.bg,
    backdropFilter: 'blur(28px) saturate(155%)',
    WebkitBackdropFilter: 'blur(28px) saturate(155%)',
    border: c.border,
    boxShadow: c.shadow,
  };
  const ref = useCursorGlow<HTMLElement>();
  if (onClick) {
    return (
      <button
        ref={ref as RefObject<HTMLButtonElement>}
        onClick={onClick}
        className="tilt-card glow-top glass-stack cursor-glow text-left flex-1 rounded-[24px] p-5 relative overflow-hidden active:scale-[0.99]"
        style={tileStyle}
      >
        <span className="cursor-glow-layer" />
        <span className="relative z-10 block">{Body}</span>
      </button>
    );
  }
  return (
    <div
      ref={ref as RefObject<HTMLDivElement>}
      className="glow-top cursor-glow flex-1 rounded-[24px] p-5 relative overflow-hidden"
      style={tileStyle}
    >
      <span className="cursor-glow-layer" />
      <span className="relative z-10 block">{Body}</span>
    </div>
  );
}

function PremiumPanel({
  icon,
  iconBg,
  title,
  subtitle,
  accent = 'slate',
  children,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  accent?: 'slate' | 'oker';
  children: ReactNode;
}) {
  const bg = accent === 'oker'
    ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 251, 235, 0.72) 100%)'
    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(248, 250, 252, 0.72) 100%)';
  const shadow = accent === 'oker'
    ? 'inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 10px 28px rgba(245, 158, 11, 0.06), 0 2px 8px rgba(15, 23, 42, 0.04)'
    : 'inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 8px 24px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.03)';
  return (
    <div
      className="glow-top glass-stack rounded-[28px] p-5 relative overflow-hidden"
      style={{
        background: bg,
        backdropFilter: 'blur(30px) saturate(155%)',
        WebkitBackdropFilter: 'blur(30px) saturate(155%)',
        border: '1px solid rgba(255, 255, 255, 0.9)',
        boxShadow: shadow,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${iconBg} text-white shadow-md shadow-black/10`}>
            {icon}
          </div>
          <h3 className="text-sm font-black text-slate-900 tracking-tight">{title}</h3>
        </div>
        {subtitle && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyTile({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8">
      <div className="w-12 h-12 rounded-2xl bg-white ring-1 ring-slate-200/60 flex items-center justify-center text-slate-300 mb-3 shadow-sm">
        {icon}
      </div>
      <p className="text-sm font-black text-slate-700">{title}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">{subtitle}</p>
    </div>
  );
}
