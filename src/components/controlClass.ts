/**
 * Klassen van het formulier-control (.control-input-look). Los van Field.tsx
 * zodat DatePicker.tsx ze kan gebruiken zonder importcirkel (Field → DateInput
 * → DatePicker → Field). Field.tsx exporteert `inputClass` gewoon door.
 */
export const inputClass =
  'control-input w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed disabled:opacity-60';

export const invalidClass = '!border-red-300 focus:!border-red-400 focus:!shadow-[0_0_0_4px_rgba(239,68,68,0.14)]';
