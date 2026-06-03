import { useState } from 'react';
import { cn } from '../lib/ui';

/**
 * Brand-logo voor login + andere prominente plekken. Probeert eerst het
 * officiële Van Hoorebeke-busbeeld te laden (public/vhb-logo.png). Bestaat
 * dat niet, dan toont het de bestaande VHB-wordmark als fallback — zo blijft
 * de app altijd werken, ook zonder asset.
 *
 * Gebruik:
 *   <BrandLogo size="lg" />     → groot, voor login left-panel
 *   <BrandLogo size="md" />     → middel, voor mobile-login & sidebar
 *
 * Tip: drop een transparante PNG of SVG in public/vhb-logo.png (of .svg).
 * Sketchy aanpak? Niet voor jou — als het bestand er niet is, blijft het
 * pure wordmark.
 */
export function BrandLogo({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  // Heights gekozen voor visueel evenwicht met de subtitle "Van Hoorebeke en Zoon"
  const heights = {
    sm: 'h-9',
    md: 'h-14',
    lg: 'h-20',
  } as const;

  if (imageFailed) {
    // Fallback: clean wordmark zonder afbeelding
    return (
      <div className={cn('flex flex-col', className)}>
        <h1 className={cn(
          'brand-wordmark brand-wordmark-anim text-slate-900 leading-none',
          size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-3xl' : 'text-2xl',
        )}>
          VHB <span className="brand-accent text-oker-500">PORTAAL</span>
        </h1>
      </div>
    );
  }

  return (
    <img
      src="/vhb-logo.png"
      alt="Van Hoorebeke en Zoon"
      onError={() => setImageFailed(true)}
      className={cn(heights[size], 'w-auto object-contain select-none', className)}
      draggable={false}
    />
  );
}
