export const THEME_STORAGE_KEY = "postarigr-theme";
export const DEFAULT_THEME = "light";

export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"){document.documentElement.classList.add("dark");}else{document.documentElement.classList.remove("dark");}}catch(e){document.documentElement.classList.remove("dark");}})();`;
