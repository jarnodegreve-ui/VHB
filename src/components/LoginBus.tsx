import { cn } from '../lib/ui';

/**
 * Prominente bus-illustratie voor het login-scherm. Toont /vhb-logo.png
 * zonder enige overlay — de PNG moet zelf netjes zijn, inclusief
 * (optioneel) een echte Belgische nummerplaat erin geverfd.
 *
 * Aspect-ratio container = 1536/1024 (= 3:2) matcht het oorspronkelijke
 * PNG-bestand zodat de bus crisp gerenderd wordt op elke breedte.
 */
export function LoginBus({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-full', className)}>
      <div className="relative" style={{ aspectRatio: '1536 / 1024' }}>
        <img
          src="/vhb-logo.png"
          alt="Van Hoorebeke en Zoon bus"
          className="absolute inset-0 w-full h-full object-contain select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}
