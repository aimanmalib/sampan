import { useText } from './i18n';

/** The first-screen picture: a sampan carrying a coin across the river, a labelled bank on each side. */
export function Scene() {
  const { t } = useText();
  return (
    <figure className="scene" aria-label={t('scene.label')} role="img">
      <svg viewBox="0 0 640 170" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <path className="scene__bank" d="M0 70 C40 66 80 72 120 76 L150 118 L0 118 Z" />
        <path className="scene__bank" d="M640 70 C600 66 560 72 520 76 L490 118 L640 118 Z" />
        <path className="scene__water" d="M0 118 H640 V170 H0 Z" />
        <path className="scene__ripple" d="M170 140 q20 -6 40 0 t40 0 M390 150 q20 -6 40 0 t40 0 M280 160 q16 -5 32 0" />
        <g className="scene__boat">
          <path className="scene__hull" d="M250 112 H390 L372 132 H268 Z" />
          <path className="scene__pole" d="M372 64 L402 150" />
          <circle className="scene__coin" cx="318" cy="96" r="16" />
          <text className="scene__coin-mark" x="318" y="101" textAnchor="middle">$</text>
        </g>
      </svg>
      <figcaption className="scene__labels">
        <span>{t('scene.left')}</span>
        <span>{t('scene.right')}</span>
      </figcaption>
    </figure>
  );
}
