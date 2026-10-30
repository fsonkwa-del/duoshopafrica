"use client";
import { useEffect, useRef, useState } from "react";

export interface Slide {
  eyebrow: string;
  title: string;
  text: string;
  cta: string;
  href: string;
  tone: "red" | "orange" | "plum";
  icon: string;
}

// Carrousel « à la une ». Sans JavaScript : défilement horizontal avec ancrage (scroll-snap) et
// points-liens. Avec JavaScript : avance seul toutes les 6 s, en pause au survol ou au focus,
// et jamais si l'utilisateur préfère réduire les animations.
export function PromoCarousel({
  slides,
  labels,
}: {
  slides: Slide[];
  labels: { region: string; previous: string; next: string; goTo: string };
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const show = (target: number) => {
    const el = track.current;
    if (!el) return;
    const next = (target + slides.length) % slides.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    setIndex(next);
  };

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || reduce.matches) return;
    const timer = window.setInterval(() => {
      const el = track.current;
      if (!el) return;
      const next =
        (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
      setIndex(next);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  return (
    <section
      className="promo-carousel"
      aria-roledescription="carousel"
      aria-label={labels.region}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="promo-track"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {slides.map((slide, i) => (
          <article
            key={slide.title}
            id={`slide-${i + 1}`}
            className={`promo-slide tone-${slide.tone}`}
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${slides.length}`}
          >
            <p className="promo-eyebrow">{slide.eyebrow}</p>
            <h2>{slide.title}</h2>
            <p>{slide.text}</p>
            <span className="promo-art" aria-hidden="true">
              {slide.icon}
            </span>
            <a className="promo-cta" href={slide.href}>
              {slide.cta}
            </a>
          </article>
        ))}
      </div>
      <div className="promo-controls">
        <button
          type="button"
          className="promo-arrow"
          aria-label={labels.previous}
          onClick={() => show(index - 1)}
        >
          ‹
        </button>
        <ol className="promo-dots">
          {slides.map((slide, i) => (
            <li key={slide.title}>
              <a
                href={`#slide-${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  show(i);
                }}
              >
                <span className="visually-hidden">
                  {labels.goTo} {i + 1}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="promo-arrow"
          aria-label={labels.next}
          onClick={() => show(index + 1)}
        >
          ›
        </button>
      </div>
    </section>
  );
}
