// Plain module (no "use client") so the server root layout can inline the script as a string.

/** Where this browser remembers a forced theme ("light" / "dark"); absent means System. */
export const THEME_STORAGE_KEY = "voice-eval:theme";

/**
 * Runs in <head> before the first paint: applies a saved Light/Dark choice to <html> so the page
 * never flashes the other palette. The server renders no `data-theme` (System).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
