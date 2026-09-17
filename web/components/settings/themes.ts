export type Theme = "classic" | "glass" | "studio";

export const THEMES: { value: Theme; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "glass", label: "Glass" },
  { value: "studio", label: "Studio" },
];

export const THEME_KEY = "flux.theme";
export const DEFAULT_THEME: Theme = "classic";

/**
 * Run before the page paints, so a stored theme never flashes the default first. Kept to plain
 * ES5, as it runs unbundled.
 */
export const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(
  THEMES.map((t) => t.value).filter((t) => t !== DEFAULT_THEME),
)}.indexOf(t)>=0)document.documentElement.dataset.theme=t}catch(e){}`;
