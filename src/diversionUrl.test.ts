import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sanitizeDiversionPdfUrl, toDatabaseDiversion } from '../api/helpers.js';

/** Server-side helft van de bijlage-validatie. Client-side weigert
 *  isSafeDocumentUrl (src/lib/ui.ts) al data:text/html en javascript:, maar de
 *  opgeslagen waarde werd tot nu toe ongecontroleerd overgenomen — een
 *  gecompromitteerde planner kon collega's zo naar een externe pagina sturen. */
describe('sanitizeDiversionPdfUrl', () => {
  const oud = process.env.SUPABASE_URL;
  beforeAll(() => { process.env.SUPABASE_URL = 'https://projref.supabase.co'; });
  afterAll(() => { process.env.SUPABASE_URL = oud; });

  it('laat een bijlage op onze eigen Storage-host door', () => {
    const eigen = 'https://projref.supabase.co/storage/v1/object/public/diversions/d-1.pdf';
    expect(sanitizeDiversionPdfUrl(eigen)).toBe(eigen);
  });

  it('weigert scriptdragende en externe URL-schemas', () => {
    expect(sanitizeDiversionPdfUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull();
    expect(sanitizeDiversionPdfUrl('javascript:alert(document.cookie)')).toBeNull();
    expect(sanitizeDiversionPdfUrl('  JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitizeDiversionPdfUrl('blob:https://projref.supabase.co/abc')).toBeNull();
  });

  it('weigert een andere host, ook via http', () => {
    expect(sanitizeDiversionPdfUrl('https://evil.example/omleiding.pdf')).toBeNull();
    expect(sanitizeDiversionPdfUrl('http://projref.supabase.co/x.pdf')).toBeNull();
    // Host-verwarring: onze hostnaam als subdomein van de aanvaller.
    expect(sanitizeDiversionPdfUrl('https://projref.supabase.co.evil.example/x.pdf')).toBeNull();
  });

  it('behandelt leeg en onzin als "geen bijlage"', () => {
    expect(sanitizeDiversionPdfUrl(undefined)).toBeNull();
    expect(sanitizeDiversionPdfUrl('')).toBeNull();
    expect(sanitizeDiversionPdfUrl('geen-url')).toBeNull();
  });

  it('past de filter toe in de database-mapper', () => {
    const rij = toDatabaseDiversion({
      id: 'd-1', line: '3', title: 'Werken', description: '',
      startDate: '2026-08-01',
      pdfUrl: 'data:text/html;base64,PHNjcmlwdD4=',
    } as any);
    expect(rij.pdfurl).toBeNull();
  });
});
