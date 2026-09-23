import { defineConfig } from 'vitest/config';

// Datumtests draaien in de tijdzone van het portaal, niet in die van de
// machine (datumtranche PR 1): gezet vóór de workers starten, die erven hem.
process.env.TZ = 'Europe/Brussels';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'shared/**/*.test.ts'],
    globals: true,
    env: { TZ: 'Europe/Brussels' },
  },
});
