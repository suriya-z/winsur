// Keep the Winsur window on its own page.
//
// The preload bridge (window.winsur.invoke, which can answer permission
// requests) is exposed to whatever page this window shows. Agent text such as
// plans is rendered as Markdown, so it can contain links. If a link loaded
// inside this window, that page could press Allow. Links therefore open in the
// default browser, where they have no bridge.

const EXTERNAL = /^(https?|mailto):/i;

function withoutHash(url) {
  return String(url || "").split("#")[0];
}

/**
 * @param {Electron.WebContents} webContents
 * @param {(url: string) => void} openExternal  e.g. url => shell.openExternal(url)
 */
function guardNavigation(webContents, openExternal) {
  const openOutside = (url) => {
    if (EXTERNAL.test(url)) openExternal(url);
  };

  webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    // Reloading the app page (dev server reloads, hash changes) is fine.
    if (withoutHash(url) === withoutHash(webContents.getURL())) return;
    event.preventDefault();
    openOutside(url);
  });
}

module.exports = { guardNavigation };
