import { useText } from './i18n';
import { SceneArt } from './SceneArt';

/** The first-screen picture: a sampan carrying a coin across the river, a labelled bank on each side. */
export function Scene() {
  const { t } = useText();
  return (
    <figure className="scene" aria-label={t('scene.label')} role="img">
      <SceneArt />
      <figcaption className="scene__labels">
        <span>{t('scene.left')}</span>
        <span>{t('scene.right')}</span>
      </figcaption>
    </figure>
  );
}
