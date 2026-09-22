import { createContext, forwardRef, useContext, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { DatePicker, type DatePickerProps } from './DatePicker';
import { inputClass, invalidClass } from './controlClass';
import { IconButton } from './primitives';

/**
 * Formulierveld-primitieven: één dialect voor label + control + hint + fout.
 *
 * - `Field` bindt label, hint en foutmelding aan het control via
 *   `htmlFor`/`aria-describedby`; de fout krijgt `role="alert"`.
 * - `Input`/`Textarea`/`Select` zijn de controls (klasse `.control-input`,
 *   radius xl, 16 px op mobiel tegen iOS-zoom). Met `invalid` kleurt de rand
 *   rood en staat `aria-invalid`.
 * - `DateInput` is het datumveld: geen native date-input (oogt per
 *   browser anders, Safari desktop het slechtst) maar de eigen DatePicker met
 *   dezelfde waarde-API ('' of 'YYYY-MM-DD').
 * - Foutmeldingen horen hier, bij het veld — niet in een toast.
 */
export { inputClass };

/**
 * Wat een control van zijn Field erft (tranche 3A, 22-09): `describedBy` en
 * `invalid` gelden voor elk control in het veld; het `id` (voor het label)
 * mag maar één control claimen, anders staan er twee elementen met dezelfde
 * id in de pagina. De claim loopt via een stabiel token per control, zodat
 * StrictMode's dubbele render en een her-render dezelfde uitkomst geven.
 */
type FieldCtx = {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  claim: (token: string) => string | undefined;
  laatLos: (token: string) => void;
};
const FieldContext = createContext<FieldCtx | null>(null);

/** Voor eigen controls (DatePicker, chipgroepen): erf id, describedBy en
 *  invalid van het omringende Field. `id` alleen als nog geen control het
 *  label heeft geclaimd en de aanroeper zelf geen id meegeeft. */
export function useVeldContext(eigenId?: string) {
  const ctx = useContext(FieldContext);
  const token = useId();
  const geclaimd = ctx && !eigenId ? ctx.claim(token) : undefined;
  useEffect(() => () => ctx?.laatLos(token), [ctx, token]);
  return { id: eigenId ?? geclaimd, describedBy: ctx?.describedBy, invalid: ctx?.invalid ?? false, required: ctx?.required ?? false };
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** id van het control; wordt gegenereerd als je `render` gebruikt. */
  htmlFor?: string;
  className?: string;
  /** Het control. Als functie: krijgt `{ id, describedBy, invalid }` om zelf
   *  door te geven. Als gewone children erven Input/Select/Textarea/DateInput
   *  id, aria-describedby en invalid vanzelf (useVeldContext). */
  children: ReactNode | ((ctx: { id: string; describedBy?: string; invalid: boolean }) => ReactNode);
}) {
  const auto = useId();
  const id = htmlFor ?? `veld-${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-fout` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);
  // Eén control claimt het id; de claim overleeft her-renders van het
  // control (zelfde token) en komt vrij als dat control unmount.
  const eigenaar = useRef<string | null>(null);
  const ctxRef = useRef<FieldCtx | null>(null);
  const claim = (token: string) => {
    if (htmlFor) return undefined; // de aanroeper koppelt zelf
    if (eigenaar.current === null || eigenaar.current === token) {
      eigenaar.current = token;
      return id;
    }
    return undefined;
  };
  const laatLos = (token: string) => {
    if (eigenaar.current === token) eigenaar.current = null;
  };
  const vorige = ctxRef.current;
  const ctx: FieldCtx =
    vorige && vorige.id === id && vorige.describedBy === describedBy && vorige.invalid === invalid && vorige.required === Boolean(required)
      ? vorige
      : { id, describedBy, invalid, required: Boolean(required), claim, laatLos };
  ctxRef.current = ctx;
  return (
    <div className={cn('space-y-1.5', className)} data-fout={error ? '' : undefined}>
      <label htmlFor={id} className="block text-label">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-red-700">*</span> : null}
      </label>
      {typeof children === 'function' ? (
        children({ id, describedBy, invalid })
      ) : (
        <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-700">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className, id, ...rest }, ref) {
    const veld = useVeldContext(id);
    const ongeldig = invalid ?? veld.invalid;
    return (
      <input
        ref={ref}
        id={veld.id}
        aria-invalid={ongeldig || undefined}
        aria-describedby={rest['aria-describedby'] ?? veld.describedBy}
        aria-required={rest.required || veld.required || undefined}
        className={cn(inputClass, ongeldig && invalidClass, className)}
        {...rest}
      />
    );
  },
);

/**
 * Zoekveld (ronde 5, F2): loep links, wis-knop zodra er iets staat,
 * `type="search"` zonder het browser-kruisje. `onChange` geeft de waarde
 * (zoals DateInput en Switch). Vervangt de 21 handgeschreven zoekvelden
 * ("Zoek…" met een losse Search-icon in een relative div).
 */
export const SearchField = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'size'> & {
  value: string;
  onChange: (waarde: string) => void;
  /** Toegankelijke naam; standaard de placeholder. */
  label?: string;
  size?: 'md' | 'sm';
}>(function SearchField({ value, onChange, label, placeholder = 'Zoeken…', size = 'md', className, ...rest }, ref) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn(inputClass, 'pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none', size === 'sm' && '!py-2')}
        {...rest}
      />
      {value ? (
        <IconButton label="Zoekopdracht wissen" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => onChange('')}>
          <X size={14} />
        </IconButton>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, rows = 3, id, ...rest }, ref) {
    const veld = useVeldContext(id);
    const ongeldig = invalid ?? veld.invalid;
    return (
      <textarea
        ref={ref}
        id={veld.id}
        rows={rows}
        aria-invalid={ongeldig || undefined}
        aria-describedby={rest['aria-describedby'] ?? veld.describedBy}
        aria-required={rest.required || veld.required || undefined}
        className={cn(inputClass, 'resize-none leading-relaxed', ongeldig && invalidClass, className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, id, ...rest }, ref) {
    const veld = useVeldContext(id);
    const ongeldig = invalid ?? veld.invalid;
    return (
      // Chevron als inline style (niet als bg-*-utilities): .control-input zet
      // `background:` als shorthand en reset daarmee repeat/position — de
      // pijl werd dan als patroon herhaald over het hele veld.
      <select
        ref={ref}
        id={veld.id}
        aria-invalid={ongeldig || undefined}
        aria-describedby={rest['aria-describedby'] ?? veld.describedBy}
        aria-required={rest.required || veld.required || undefined}
        className={cn(inputClass, 'appearance-none pr-9', ongeldig && invalidClass, className)}
        style={{
          // Tint per thema uit index.css (--select-pijl): de oude vaste
          // slate-400-hex flipte niet mee in dark (ronde 5, B6).
          backgroundImage: 'var(--select-pijl)',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.75rem center',
          backgroundSize: '16px 16px',
        }}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

/**
 * Datumveld in de stijl van `Input`, voor in een `Field`:
 * `<Field label="Van">{({ id, describedBy, invalid }) => <DateInput id={id} aria-describedby={describedBy} invalid={invalid} value onChange />}</Field>`.
 * Waarde-API zoals het native veld: `value` = '' of 'YYYY-MM-DD',
 * `onChange(value)` met de string (geen event), `min`/`max`/`disabled`/`required`.
 * `size="sm"` voor inline-navigatievelden (dekking, laadplein).
 */
export const DateInput = forwardRef<HTMLButtonElement, DatePickerProps>(function DateInput(props, ref) {
  const veld = useVeldContext(props.id);
  return (
    <DatePicker
      ref={ref}
      {...props}
      id={veld.id}
      invalid={props.invalid ?? veld.invalid}
      aria-describedby={props['aria-describedby'] ?? veld.describedBy}
      required={props.required ?? veld.required}
    />
  );
});
