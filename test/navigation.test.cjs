const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { guardNavigation } = require("../electron/navigation.cjs");

const APP_URL = "file:///C:/Program%20Files/Winsur/resources/app.asar/dist/index.html";

/** Just enough of Electron's webContents for the guard. */
function fakeWebContents(currentUrl = APP_URL) {
  const wc = new EventEmitter();
  wc.getURL = () => currentUrl;
  wc.setWindowOpenHandler = (handler) => {
    wc.openHandler = handler;
  };
  return wc;
}

function navigate(wc, url) {
  let prevented = false;
  wc.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
  return prevented;
}

test("a link to a web page does not load inside the Winsur window", () => {
  const wc = fakeWebContents();
  const opened = [];
  guardNavigation(wc, (url) => opened.push(url));

  const prevented = navigate(wc, "https://evil.example/docs.html");

  assert.equal(prevented, true);
  assert.deepEqual(opened, ["https://evil.example/docs.html"]);
});

test("a link that asks for a new window opens in the default browser instead", () => {
  const wc = fakeWebContents();
  const opened = [];
  guardNavigation(wc, (url) => opened.push(url));

  const result = wc.openHandler({ url: "https://example.com/guide" });

  assert.deepEqual(result, { action: "deny" });
  assert.deepEqual(opened, ["https://example.com/guide"]);
});

test("links that are not http, https or mailto are blocked and not opened anywhere", () => {
  const wc = fakeWebContents();
  const opened = [];
  guardNavigation(wc, (url) => opened.push(url));

  assert.equal(navigate(wc, "file:///C:/Users/me/evil.html"), true);
  assert.deepEqual(wc.openHandler({ url: "javascript:alert(1)" }), { action: "deny" });
  assert.deepEqual(opened, []);
});

test("reloading the app page itself is allowed", () => {
  const wc = fakeWebContents();
  guardNavigation(wc, () => assert.fail("reload must not open a browser"));

  assert.equal(navigate(wc, `${APP_URL}#settings`), false);
});
