import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/ui';
import { DatePicker, type DatePickerProps } from './DatePicker';
import { inputClass, invalidClass } from './controlClass';

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
  /** Het control. Als functie: krijgt `{ id, describedBy, invalid }` om zelf door te geven. */
  children: ReactNode | ((ctx: { id: string; describedBy?: string; invalid: boolean }) => ReactNode);
}) {
  const auto = useId();
  const id = htmlFor ?? `veld-${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-fout` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-label">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-red-700">*</span> : null}
      </label>
      {typeof children === 'function' ? children({ id, describedBy, invalid: Boolean(error) }) : children}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-700">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputClass, invalid && invalidClass, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={cn(inputClass, 'resize-none leading-relaxed', invalid && invalidClass, className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, ...rest }, ref) {
    return (
      // Chevron als inline style (niet als bg-*-utilities): .control-input zet
      // `background:` als shorthand en reset daarmee repeat/position — de
      // pijl werd dan als patroon herhaald over het hele veld.
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(inputClass, 'appearance-none pr-9', invalid && invalidClass, className)}
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239AA1A9' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
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
  return <DatePicker ref={ref} {...props} />;
});
