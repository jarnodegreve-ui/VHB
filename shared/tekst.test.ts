import { describe, expect, it } from 'vitest';
import { citaat, formatTelefoon, telefoonCijfers } from './tekst';

describe('formatTelefoon', () => {
  it('zet een Belgisch mobiel nummer in groepen van 4-2-2-2, hoe het ook ingetikt is', () => {
    expect(formatTelefoon('0472123456')).toBe('0472 12 34 56');
    expect(formatTelefoon('0472/12.34.56')).toBe('0472 12 34 56');
    expect(formatTelefoon('0472 12 34 56')).toBe('0472 12 34 56');
    expect(formatTelefoon(' 0472-12-34-56 ')).toBe('0472 12 34 56');
  });
  it('leest +32 en 0032 als Belgisch en toont de nationale vorm', () => {
    expect(formatTelefoon('+32472123456')).toBe('0472 12 34 56');
    expect(formatTelefoon('+32 (0)472 12 34 56')).toBe('0472 12 34 56');
    expect(formatTelefoon('0032 9 123 45 67')).toBe('09 123 45 67');
  });
  it('kent de tweecijferige zones en de driecijferige', () => {
    expect(formatTelefoon('091234567')).toBe('09 123 45 67');
    expect(formatTelefoon('021234567')).toBe('02 123 45 67');
    expect(formatTelefoon('053123456')).toBe('053 12 34 56');
    expect(formatTelefoon('050 12 34 56')).toBe('050 12 34 56');
    expect(formatTelefoon('070123456')).toBe('070 12 34 56');
  });
  it('zet een dienstnummer in groepen van 4-2-3', () => {
    expect(formatTelefoon('080012345')).toBe('0800 12 345');
    expect(formatTelefoon('0900 12 345')).toBe('0900 12 345');
  });
  it('laat wat geen Belgisch nummer is ongemoeid, zodat er nooit iets verloren gaat', () => {
    expect(formatTelefoon('+31 6 12345678')).toBe('+31 6 12345678');
    expect(formatTelefoon('1207')).toBe('1207');
    expect(formatTelefoon('binnenpost 12')).toBe('binnenpost 12');
  });
  it('geeft een lege tekst voor niets', () => {
    expect(formatTelefoon(null)).toBe('');
    expect(formatTelefoon(undefined)).toBe('');
    expect(formatTelefoon('   ')).toBe('');
  });
});

describe('telefoonCijfers', () => {
  it('houdt alleen de cijfers over en laat de (0) na een landcode vallen', () => {
    expect(telefoonCijfers('+32 (0)472 12 34 56')).toBe('32472123456');
    expect(telefoonCijfers('0472/12.34.56')).toBe('0472123456');
    expect(telefoonCijfers(null)).toBe('');
  });
});

describe('citaat', () => {
  it('zet typografische aanhalingstekens rond de tekst', () => {
    expect(citaat('Familiefeest')).toBe('“Familiefeest”');
  });
});
