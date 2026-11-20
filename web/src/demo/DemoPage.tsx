// /demo (ADR 0082, ADR 0084, features.demo): the one minute cut first (English subtitles burned in), then the full
// walkthrough with a subtitle track for every page language and its chapters from docs/demo/chapters.json, both in the
// browser's own player and both from the media host (config media.host), never from this site's host. A chapter button moves the video to
// the chapter and plays it from there (only on that click); every chapter lists the mainnet transaction ids it shows,
// each opening in the explorer config names, and the status page of the crossing when it is on this site.
import { useEffect, useRef } from 'react';
import chapterFile from '../../../docs/demo/chapters.json';
import { trackPath, type DemoFile } from '../../../core/demo';
import { normalTxid, type ProofTxid } from '../../../core/proof';
import proof from 'virtual:sampan-proof';
import type { LoadedConfig } from '../config';
import { runText } from '../how/txLinks';
import { useText, type TextKey } from '../i18n';
import './demo.css';

const file = chapterFile as DemoFile;
// Chain of each id as the Runs table writes it, so a link opens the right explorer.
const chainOf = new Map<string, ProofTxid>(proof.runs.flatMap((r) => r.txids.map((x) => [normalTxid(x.id), x] as const)));

export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function DemoPage({ config }: { config: LoadedConfig | null }) {
  const { lang, t } = useText();
  const video = useRef<HTMLVideoElement>(null);
  // WebKit ignores `default` when deciding which subtitles to show, so the page language's track is shown by setting its
  // mode once the tracks exist (now, on loadedmetadata, as each track is added) and again when the language changes.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const show = (): void => {
      for (const tr of Array.from(v.textTracks)) tr.mode = tr.language === lang ? 'showing' : 'disabled';
    };
    show();
    v.addEventListener('loadedmetadata', show);
    v.textTracks.addEventListener('addtrack', show);
    return () => {
      v.removeEventListener('loadedmetadata', show);
      v.textTracks.removeEventListener('addtrack', show);
    };
  }, [lang, config]);
  if (!config) return null;
  const links = runText(config, t);

  const jump = (start: number): void => {
    const v = video.current;
    if (!v) return;
    const go = (): void => {
      v.currentTime = start;
      void v.play().catch(() => undefined);
    };
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) go();
    else v.addEventListener('loadedmetadata', go, { once: true });
    v.scrollIntoView({ block: 'nearest' });
  };

  return (
    <article className="how demo">
      <p className="how__back">
        <a href="/">{t('how.back')}</a>
      </p>
      <h1 className="how__title">{t('demo.title')}</h1>
      <p className="how__lead">{t('demo.lead')}</p>
      <video className="demo__video" controls playsInline preload="metadata" poster={config.demo.poster} data-demo-video="short">
        <source src={config.demo.video} type="video/mp4" />
        {t('demo.noVideo')}
      </video>
      <h2 className="demo__heading">{t('demo.full', { time: clock(file.seconds) })}</h2>
      <video ref={video} className="demo__video" controls playsInline preload="metadata" poster={config.demo.poster} data-demo-video="long">
        <source src={config.demo.videoLong} type="video/mp4" />
        {config.i18n.languages.map((l) => (
          <track key={l.code} kind="subtitles" srcLang={l.code} label={l.name} src={trackPath(config.demo.tracks, l.code)} default={l.code === lang} />
        ))}
        {t('demo.noVideo')}
      </video>
      {config.demo.youtubeUrl ? (
        <p className="demo__also">
          <a href={config.demo.youtubeUrl}>{t('demo.youtube')}</a>
        </p>
      ) : null}
      <h2 className="demo__heading">{t('demo.chapters')}</h2>
      <ol className="demo__chapters">
        {file.chapters.map((c) => {
          const title = t(c.titleKey as TextKey, file.vars);
          const shown = c.txids.slice(0, config.demo.txidsShown);
          const more = c.txids.length - shown.length;
          return (
            <li key={c.id} className="demo__chapter" data-chapter={c.id}>
              <button type="button" className="demo__jump" data-start={c.start} onClick={() => jump(c.start)}>
                <span className="demo__time mono">{clock(c.start)}</span>
                <span className="demo__title">{title}</span>
              </button>
              <p className="demo__label">{t('demo.txids')}</p>
              <ul className="demo__txids">
                {shown.map((id) => {
                  const x = chainOf.get(normalTxid(id)) ?? { chain: 'bch', id };
                  return (
                    <li key={id}>
                      <span className="demo__chain">{links.chainName(x.chain)}</span>{' '}
                      <a className="mono demo__txid" href={links.href(x)} data-txid={id}>
                        {id}
                      </a>
                    </li>
                  );
                })}
              </ul>
              {more > 0 ? (
                <p className="demo__more">
                  <a href="/how#proof">{t('demo.more', { n: String(more) })}</a>
                </p>
              ) : null}
              {c.receipt ? (
                <p className="demo__more">
                  <a href={c.receipt}>{t('demo.receipt')}</a>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </article>
  );
}
