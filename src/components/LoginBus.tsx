import { cn } from '../lib/ui';

/**
 * Prominente bus-illustratie voor het login-scherm. Toont /vhb-logo.png
 * met een cleane Belgische nummerplaat als CSS-overlay over de slordige
 * plek onder het MAN-embleem.
 *
 * Plaat-positie en -grootte zijn percentage-based van de container, en
 * aanpasbaar via de constanten hieronder. Mocht de plaat niet exact op
 * de juiste plek staan: tweak deze waardes.
 */

// Positie + grootte van de plaat als % van de bus-container.
// Tuned voor /vhb-logo.png (1536×1024) waar de werkelijke nummerplaat
// onder het MAN-embleem aan de voorzijde zit (rechts-onder de windscreen).
const PLATE = {
  left: '71%',
  top: '62%',
  width: '7%',
  // Belgische plaat-verhouding ≈ 4.7 : 1
  aspectRatio: '4.7 / 1',
} as const;

export function LoginBus({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-full', className)}>
      {/* Aspect-ratio container — match van de PNG (1536×1024 = 3:2) */}
      <div className="relative" style={{ aspectRatio: '1536 / 1024' }}>
        <img
          src="/vhb-logo.png"
          alt="Van Hoorebeke en Zoon bus"
          className="absolute inset-0 w-full h-full object-contain select-none"
          draggable={false}
        />

        {/* Nummerplaat-overlay — Belgische stijl. containerType: 'inline-size'
            zorgt dat de cqi-unit op de plaat-tekst werkt (% van plaat-breedte). */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: PLATE.left,
            top: PLATE.top,
            width: PLATE.width,
            aspectRatio: PLATE.aspectRatio,
            containerType: 'inline-size',
          }}
        >
          <BelgianLicensePlate text="1-VHB-922" />
        </div>
      </div>
    </div>
  );
}

/**
 * Cleane Belgische nummerplaat (modern model post-2010):
 *  - witte plaat met dunne rode rand
 *  - rode karakters in monospace
 *  - schaalt mee met plaat-breedte via cqi-units
 */
function BelgianLicensePlate({ text }: { text: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center font-black text-red-700 select-none overflow-hidden whitespace-nowrap"
      style={{
        background: '#ffffff',
        borderRadius: '2px',
        border: '0.5px solid #b91c1c',
        boxShadow: '0 0.5px 1px rgba(0, 0, 0, 0.2)',
        // 18cqi = 18% van plaat-breedte. Bij 40px plaat → 7.2px tekst.
        fontSize: '18cqi',
        letterSpacing: '0.02em',
        fontFamily:
          '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );
}
