// The sampan drawing on its own, with no hooks, so the link preview tool can render the same picture outside the app.
// The pragma below keeps the automatic JSX runtime when tools/ runs this file with tsx.
/** @jsxRuntime automatic */
// `fit` slice lets a phone draw the picture shorter than the drawing: the river's lower edge is cropped, the boat keeps its size.
export function SceneArt({ viewBox = '0 56 640 114', fit = 'meet' }: { viewBox?: string; fit?: 'meet' | 'slice' }) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio={fit === 'slice' ? 'xMidYMin slice' : 'xMidYMid meet'} aria-hidden="true" focusable="false">
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
  );
}
