import { cn } from '../lib/ui';

/**
 * Prominente bus-illustratie voor het login-scherm. Toont /vhb-logo.png
 * (de officiële VHB-bus) met een cleane Belgische nummerplaat als
 * CSS-overlay over de slordige plek onder het MAN-embleem.
 *
 * Positionering: aspect-ratio container + percentage-based overlay zodat
 * de plaat exact op de juiste plek blijft ongeacht render-breedte.
 *
 * Plate-tekst "1-VHB-922" verbindt de bedrijfsinitialen met het
 * stichtingsjaar 1922.
 */
export function LoginBus({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-full', className)}>
      {/* Aspect-ratio container — match van de PNG zodat de overlay correct uitlijnt */}
      <div className="relative" style={{ aspectRatio: '375 / 250' }}>
        <img
          src="/vhb-logo.png"
          alt="Van Hoorebeke en Zoon bus"
          className="absolute inset-0 w-full h-full object-contain select-none"
          draggable={false}
        />

        {/* Nummerplaat-overlay — Belgische stijl: dunne rode rand, witte plaat,
            rode karakters. Positionering en grootte percentage-based zodat
            ze meeschalen met de PNG. */}
        <div
          className="absolute pointer-events-none"
          style={{
            // Plaat zit onder het MAN-embleem aan de voorzijde
            left: '63.5%',
            top: '70.5%',
            width: '17%',
            aspectRatio: '4.5 / 1',
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
 *  - witte plaat, dunne rode rand, rode karakters
 *  - schaalt automatisch met container via cqw-units
 */
function BelgianLicensePlate({ text }: { text: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center font-black text-red-700 select-none overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #fff 0%, #f5f5f5 100%)',
        borderRadius: 'clamp(1px, 6%, 4px)',
        border: '1px solid #b91c1c',
        boxShadow:
          'inset 0 0 0 1px rgba(255, 255, 255, 0.85), 0 1px 2px rgba(0, 0, 0, 0.18)',
        // Letter scaling via container-query — blijft scherp op elke breedte
        fontSize: 'min(2.2cqw, 16px)',
        letterSpacing: '0.04em',
        fontFamily:
          '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
        containerType: 'inline-size',
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );
}
