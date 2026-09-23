import { forwardRef, useRef, type FormEvent, type FormHTMLAttributes } from 'react';

/**
 * Het formulier-element van het portaal (tranche 3A, 22-09-2026).
 *
 * - Een echte <form>: Enter in een tekstveld dient in, zoals de browser het
 *   bedoelt. 24 formulieren hadden alleen een knop met onClick en deden op
 *   Enter niets.
 * - `onVerstuur` mag async zijn; na afloop gaat de focus naar het eerste
 *   ongeldige veld (aria-invalid, of het control in een Field met fout) en
 *   scrolt dat in beeld. Zo hoeft geen enkel formulier dat zelf te doen.
 * - Een datumveld met een ongeldige getypte datum houdt de submit tegen.
 * - Native constraint validation (`required`, `pattern`) blijft werken; de
 *   browser focust dan zelf. Wie alles via zod doet, zet `noValidate`.
 *
 *   <Formulier onVerstuur={opslaan}>
 *     <Field label="Naam" error={fouten.fouten.naam}><Input … /></Field>
 *     <Button type="submit" bezig={bezig}>Opslaan</Button>
 *   </Formulier>
 */

const FOUT_SELECTOR = [
  '[aria-invalid="true"]',
  '[data-fout] input:not([type="hidden"])',
  '[data-fout] select',
  '[data-fout] textarea',
  '[data-fout] button',
  '[data-fout] [tabindex]:not([tabindex="-1"])',
].join(', ');

/** Focust het eerste ongeldige veld binnen `root`; true als er een was. */
export function focusEersteFout(root: ParentNode | null | undefined): boolean {
  const el = root?.querySelector<HTMLElement>(FOUT_SELECTOR);
  if (!el) return false;
  el.focus({ preventScroll: true });
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  return true;
}

export type FormulierProps = Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  /** Wordt aangeroepen bij submit (knop of Enter); preventDefault is al gedaan. */
  onVerstuur: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>;
};

export const Formulier = forwardRef<HTMLFormElement, FormulierProps>(function Formulier({ onVerstuur, children, ...rest }, ref) {
  const eigen = useRef<HTMLFormElement | null>(null);
  const zetRef = (el: HTMLFormElement | null) => {
    eigen.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Een datumveld met een ongeldige getypte datum (DatePicker zet
    // `data-datum-fout` synchroon bij blur/Enter) heeft zijn waarde niet
    // doorgegeven: indienen zou de oude waarde versturen. Niet indienen,
    // de fout staat al bij het veld (datumtranche PR 1).
    const datumFout = eigen.current?.querySelector<HTMLElement>('[data-datum-fout]');
    if (datumFout) {
      datumFout.focus();
      return;
    }
    try {
      await onVerstuur(event);
    } finally {
      // Na de state-update van de handler (React flusht die pas na deze
      // taak): dan pas staan aria-invalid en data-fout in de DOM.
      const form = eigen.current;
      window.setTimeout(() => {
        if (form && form.isConnected) focusEersteFout(form);
      }, 0);
    }
  };
  return (
    <form ref={zetRef} onSubmit={(e) => void onSubmit(e)} {...rest}>
      {children}
    </form>
  );
});
