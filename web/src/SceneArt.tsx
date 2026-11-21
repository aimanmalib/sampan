// The sampan drawing on its own, with no hooks, so the link preview tool can render the same picture outside the app.
// The pragma below keeps the automatic JSX runtime when tools/ runs this file with tsx.
/** @jsxRuntime automatic */
// `fit` slice lets a phone draw the picture shorter than the drawing: the river's lower edge is cropped, the boat keeps its size.
// Flat shapes only, every colour from the theme tokens (scene.css). The boat rests in midstream; on the front page,
// where motion is allowed, it arrives there once from the far jetty (transform only, scene.css) and then stays.
// `sky` paints the air above the water in the paper colour, for a ground that is not paper (the footer).
export function SceneArt({ viewBox = '0 56 640 114', fit = 'meet', sky = false }: { viewBox?: string; fit?: 'meet' | 'slice'; sky?: boolean }) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio={fit === 'slice' ? 'xMidYMin slice' : 'xMidYMid meet'} aria-hidden="true" focusable="false">
      {sky ? <path className="scene__sky" d="M0 0 H640 V118 H0 Z" /> : null}
      {/* Far shore, then the two banks with a jetty each: a deck on two piles and a taller mooring post at its end. */}
      <path className="scene__far" d="M150 118 C210 108 262 112 320 110 C384 108 432 108 490 118 Z" />
      <path className="scene__bank" d="M0 72 C38 66 82 70 116 78 C128 81 136 92 142 118 L0 118 Z" />
      <path className="scene__bank" d="M640 72 C602 66 558 70 524 78 C512 81 504 92 498 118 L640 118 Z" />
      <path className="scene__water" d="M0 118 H640 V170 H0 Z" />
      <path className="scene__depth" d="M0 146 C80 142 150 150 236 146 C330 142 400 150 486 146 C548 143 600 148 640 146 V170 H0 Z" />
      <path className="scene__jetty" d="M124 109 H184 M150 109 V127 M182 100 V129 M516 109 H456 M490 109 V127 M458 100 V129" />
      <path className="scene__glint" d="M34 132 h26 M88 141 h14 M206 152 h30 M286 163 h20 M420 137 h28 M536 150 h18 M586 133 h22 M352 156 h12" />
      <g className="scene__boat">
        <g className="scene__bob">
          <ellipse className="scene__shade" cx="320" cy="131" rx="66" ry="4.5" />
          <path className="scene__pole" d="M374 62 L398 146" />
          <circle className="scene__coin" cx="318" cy="96" r="16" />
          <circle className="scene__coin-ring" cx="318" cy="96" r="11.5" />
          <text className="scene__coin-mark" x="318" y="101.5" textAnchor="middle">$</text>
          <path className="scene__hull" d="M246 103 Q320 117 394 103 Q384 130 356 130 H284 Q256 130 246 103 Z" />
          <path className="scene__rail" d="M254 106.5 Q320 119.5 386 106.5" />
        </g>
      </g>
    </svg>
  );
}
