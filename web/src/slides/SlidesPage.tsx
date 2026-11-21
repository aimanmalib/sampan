// /slides (features.slides, K5P5): the event deck as full-screen slides, from the same slide text as the printed PDF
// (tools/deck/content.ts, laid out by tools/deck/deck.css). The slide text is English, the event's language; the controls
// speak the page language. Arrow keys, Page Up/Down, Home/End, a sideways swipe, the buttons and #n in the address move
// between slides; Full screen shows only where the browser allows it. "Try it in a minute" carries the one minute demo
// video from the media host while features.demo is on, otherwise its poster, a frame of the live site. Nothing here
// loads from another origin until the play button is pressed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { headline } from 'virtual:sampan-proof';
import en from '../../../lang/en.json';
import { symbolList } from '../../../core/flows';
import { pitchFrom } from '../../../core/pitch';
import { slides, TEMPLATE_TITLES, type Slide } from '../../../tools/deck/content';
import { fetchConfig, useConfig, type LoadedConfig } from '../config';
import { applyLanguages, useText } from '../i18n';
import { fitScale, hashOf, keyTarget, slideFromHash, swipeStep } from './nav';
import '../../../tools/deck/deck.css';
import './slides.css';

const W = 1280;
const H = 720;
const TOTAL = TEMPLATE_TITLES.length;
const TRY_SLIDE = TEMPLATE_TITLES.indexOf('Try it in a minute');
const MOVE_KEYS = new Set(['ArrowRight', 'ArrowLeft', ' ', 'PageDown', 'PageUp', 'Home', 'End']);

function deckOf(config: LoadedConfig): Slide[] {
  const pitch = pitchFrom(en, headline, symbolList(config.route.symbols, en['text.and']));
  return slides({ siteUrl: config.site.url, repoUrl: config.banner.repoUrl, tokenAddress: config.banner.tokenAddress, pitch });
}

/** Bare https URLs in slide text become links, as they are in the PDF. */
function linked(text: string): ReactNode[] {
  return text.split(/(https:\/\/\S+)/).map((part, i) => (i % 2 ? <a key={i} href={part}>{part}</a> : part));
}

function SlideView({ slide, n, media, extra }: { slide: Slide; n: number; media: ReactNode; extra: ReactNode }) {
  return (
    <section className={slide.cover ? 'slide slide--cover' : 'slide'} data-slide={n + 1}>
      {slide.cover ? (
        <div className="bar" />
      ) : (
        <div className="slide__mark" aria-hidden="true">
          <img src="/favicon.svg" alt="" />
        </div>
      )}
      <h1>{slide.title}</h1>
      {slide.lead ? <p className="lead">{linked(slide.lead)}</p> : null}
      {slide.points?.length || media ? (
        <div className="body">
          {slide.points?.length ? <ul>{slide.points.map((p, i) => <li key={i}>{linked(p)}</li>)}</ul> : null}
          {media}
        </div>
      ) : null}
      {slide.foot?.length || extra ? (
        <div className="foot">
          {slide.foot?.map((f, i) => <p key={i}>{linked(f)}</p>)}
          {extra}
        </div>
      ) : null}
      <div className="slide__n" aria-hidden="true">
        {n + 1} / {TOTAL}
      </div>
    </section>
  );
}

function TryMedia({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // WebKit fetches a video's start even with preload="none", so the video element exists only after the press, and
  // plays inside that same press (a layout effect runs before the click's task ends).
  useLayoutEffect(() => {
    if (playing) void video.current?.play().catch(() => undefined);
  }, [playing]);
  if (!config.features.demo) {
    return (
      <div className="slide__media">
        <img src={config.demo.poster} alt={t('slides.shot')} />
      </div>
    );
  }
  return (
    <div className="slide__media">
      {playing ? (
        <video ref={video} controls playsInline poster={config.demo.poster} src={config.demo.video} data-slides-video>
          {t('demo.noVideo')}
        </video>
      ) : (
        <button type="button" className="slide__play" onClick={() => setPlaying(true)} aria-label={t('slides.video')}>
          <img src={config.demo.poster} alt="" />
          <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <circle cx="32" cy="32" r="30" />
            <path d="M26 20l18 12-18 12z" />
          </svg>
        </button>
      )}
    </div>
  );
}

const Chevron = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function SlidesPage() {
  const { t } = useText();
  const config = useConfig();
  const list = useMemo(() => (config ? deckOf(config) : []), [config]);
  const [index, setIndex] = useState(() => slideFromHash(location.hash, TOTAL));
  const [scale, setScale] = useState(0);
  const [full, setFull] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const canFull = document.fullscreenEnabled === true;

  const go = (i: number): void => {
    setIndex(i);
    if (location.hash !== hashOf(i)) history.replaceState(null, '', hashOf(i));
  };

  useEffect(() => {
    fetchConfig().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (config) applyLanguages(config.i18n);
  }, [config]);
  useEffect(() => {
    document.title = `${t('slides.label')} · ${t('banner.event')}`;
  }, [t]);

  useEffect(() => {
    const onHash = (): void => setIndex(slideFromHash(location.hash, TOTAL));
    const onFull = (): void => setFull(document.fullscreenElement !== null);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || tag === 'VIDEO' || tag === 'INPUT') return;
      if (e.key === ' ' && (tag === 'BUTTON' || tag === 'A')) return;
      if (!MOVE_KEYS.has(e.key)) return;
      e.preventDefault();
      const next = keyTarget(e.key, index, TOTAL);
      if (next !== index) go(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = (): void => setScale(fitScale(el.clientWidth, el.clientHeight, W, H));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    press.current = (e.target as HTMLElement).closest('video, a, button') ? null : { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    const start = press.current;
    press.current = null;
    if (!start || !config) return;
    const step = swipeStep(e.clientX - start.x, e.clientY - start.y, config.ui.slideSwipePx);
    if (step) go(Math.min(Math.max(index + step, 0), TOTAL - 1));
  };

  const slide = list[index];
  const last = index === TOTAL - 1;
  const pdf = config?.banner.deckPdfUrl ? (
    <a className="slides__pdf" href={config.banner.deckPdfUrl} aria-label={t('slides.pdf')}>
      PDF
    </a>
  ) : null;

  return (
    <div className="slides" aria-label={t('slides.label')} role="region" aria-roledescription="carousel">
      <div className="slides__area" ref={area} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (press.current = null)}>
        {slide && config && scale > 0 ? (
          <div className="slides__frame" style={{ width: W * scale, height: H * scale }} aria-roledescription="slide" aria-label={t('slides.position', { n: String(index + 1), total: String(TOTAL) })} role="group">
            <div className="deck slides__scale" style={{ transform: `scale(${scale})` }}>
              <SlideView
                slide={slide}
                n={index}
                media={index === TRY_SLIDE ? <TryMedia config={config} /> : null}
                extra={last && config.banner.deckPdfUrl ? <p><a href={config.banner.deckPdfUrl}>{t('slides.pdf')}</a></p> : null}
              />
            </div>
          </div>
        ) : null}
      </div>
      <nav className="slides__bar" aria-label={t('slides.label')}>
        <a className="slides__home" href="/">
          {t('how.back')}
        </a>
        <span className="slides__moves">
          <button type="button" className="slides__btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t('slides.prev')}>
            <Chevron back />
          </button>
          <span className="slides__pos" aria-live="polite" data-slides-pos={index + 1}>
            <span aria-hidden="true">
              {index + 1} / {TOTAL}
            </span>
            <span className="visually-hidden">{t('slides.position', { n: String(index + 1), total: String(TOTAL) })}</span>
          </span>
          <button type="button" className="slides__btn" onClick={() => go(index + 1)} disabled={last} aria-label={t('slides.next')}>
            <Chevron />
          </button>
        </span>
        <span className="slides__end">
          {pdf}
          {canFull ? (
            <button
              type="button"
              className="slides__full"
              onClick={() => void (full ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
            >
              {full ? t('slides.exitFullscreen') : t('slides.fullscreen')}
            </button>
          ) : null}
        </span>
      </nav>
    </div>
  );
}
