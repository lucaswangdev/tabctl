/**
 * tabctl background service worker
 * Handles communication between popup and local server
 */

const SERVER = "http://localhost:7420";

// Check server health on startup
async function checkServer() {
  try {
    const res = await fetch(`${SERVER}/health`);
    const data = await res.json();
    console.log("tabctl-server connected:", data);
    return true;
  } catch {
    console.warn("tabctl-server not reachable at", SERVER);
    return false;
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_SERVER") {
    checkServer().then(sendResponse);
    return true; // keep channel open for async
  }

  if (msg.type === "GET_CURRENT_TABS") {
    // Return all open tabs in current window
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      sendResponse(tabs.map((t) => ({
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
        id: t.id,
      })));
    });
    return true;
  }

  if (msg.type === "GET_ALL_TABS") {
    // Return all open tabs across all windows
    chrome.tabs.query({}, (tabs) => {
      sendResponse(tabs.map((t) => ({
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
        windowId: t.windowId,
        id: t.id,
      })));
    });
    return true;
  }

  if (msg.type === "OPEN_URLS") {
    // Open array of URLs as new tabs
    const { urls } = msg;
    urls.forEach((url, i) => {
      setTimeout(() => chrome.tabs.create({ url, active: i === 0 }), i * 150);
    });
    sendResponse({ opened: urls.length });
    return true;
  }

  if (msg.type === "CLOSE_TAB") {
    chrome.tabs.remove(msg.tabId, () => sendResponse({ closed: true }));
    return true;
  }

  if (msg.type === "CLOSE_CURRENT_WINDOW_TABS") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const tabIds = tabs.map(t => t.id);
      if (tabIds.length === 0) { sendResponse({ closed: 0 }); return; }
      chrome.tabs.remove(tabIds, () => sendResponse({ closed: tabIds.length }));
    });
    return true;
  }
});

checkServer();
