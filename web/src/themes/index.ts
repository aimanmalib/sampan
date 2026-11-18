// Every theme listed in web/src/themes/ ships in the stylesheet; each is scoped to :root[data-theme='<name>'],
// and the built HTML names the one config ui.theme picks, so only that one applies.
import.meta.glob('./*.css', { eager: true });
