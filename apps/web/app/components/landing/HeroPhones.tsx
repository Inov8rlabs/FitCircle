'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import styles from './landing.module.css';
import { Phone, type Shot } from './Phone';

/**
 * The hero device stack: the home screen in front, food log and circle behind.
 * Scroll parallax via one CSS variable (rAF-throttled, passive listener), off
 * for reduced motion. The front phone is the LCP image (priority).
 */
export function HeroPhones({ front, left, right }: { front: Shot; left: Shot; right: Shot }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--parallax', String(Math.min(600, window.scrollY)));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="relative mx-auto flex h-[min(132vw,560px)] w-full max-w-[560px] items-start justify-center sm:h-[600px] lg:h-[640px]" aria-hidden={false}>
      <div aria-hidden className={cn('pointer-events-none absolute inset-0 -z-10 blur-2xl', styles.glow)} />
      <div
        className={cn('absolute left-[2%] top-[9%] opacity-90 sm:left-[4%]', styles.phone)}
        style={{ ['--depth' as string]: -0.12, ['--tilt' as string]: '-7deg' }}
      >
        <div className={styles.float} style={{ ['--float-delay' as string]: '-2s' }}>
          <Phone shot={left} width="clamp(150px, 40vw, 236px)" sizes="(max-width: 640px) 40vw, 236px" />
        </div>
      </div>
      <div
        className={cn('absolute right-[2%] top-[9%] opacity-90 sm:right-[4%]', styles.phone)}
        style={{ ['--depth' as string]: -0.08, ['--tilt' as string]: '7deg' }}
      >
        <div className={styles.float} style={{ ['--float-delay' as string]: '-4s' }}>
          <Phone shot={right} width="clamp(150px, 40vw, 236px)" sizes="(max-width: 640px) 40vw, 236px" />
        </div>
      </div>
      <div className={cn('relative z-10', styles.phone)} style={{ ['--depth' as string]: -0.2 }}>
        <div className={styles.float}>
          <Phone shot={front} width="clamp(196px, 54vw, 290px)" sizes="(max-width: 640px) 54vw, 290px" priority />
        </div>
      </div>
    </div>
  );
}
