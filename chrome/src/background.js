chrome.runtime.setUninstallURL("https://explore.dev/", function () {});

const defaultEndpoint = 'http://34.65.59.115:30000/resolve/';

chrome.runtime.onMessage.addListener(
  function(msg, sender, sendResponse) {
    chrome.storage.local.get({
      endpoint: defaultEndpoint,
    }, function(items) {
      let endpoint = items.endpoint;
      console.log('[explore.dev] Using endpoint: %s', endpoint);

      if (msg.type === 'blob') {
        endpoint += 'blob?'
        + 'slug=' + encodeURIComponent(msg.slug)
        + '&commit=' + encodeURIComponent(msg.commit)
        + '&path=' + encodeURIComponent(msg.path);
      } else if (msg.type === 'commit') {
        endpoint += 'commit?'
        + 'slug=' + encodeURIComponent(msg.slug)
        + '&commit=' + encodeURIComponent(msg.commit);
      } else if (msg.type === 'pr') {
        endpoint += 'pr?'
        + 'slug=' + encodeURIComponent(msg.slug)
        + '&id=' + encodeURIComponent(msg.id)
        + '&base=' + encodeURIComponent(msg.base)
        + '&old=' + encodeURIComponent(msg.old)
        + '&new=' + encodeURIComponent(msg.new);
      } else {
        sendResponse({msg: msg, error: 'Unsupported message type: ' + msg.type});
        return;
      }

      //fetch(endpoint, {credentials: 'omit'})
      fetch(endpoint)
      .then(async (response) => {
        if (response.ok) {
          return response;
        }

        const text = await response.text();
        throw new Error(response.status + ': ' + text);
      })
      .then((response) => response.json())
      .then((refs) => sendResponse({msg: msg, result: refs}))
      .catch((reason) => {
        console.log('[explore.dev] ERROR while resolving reference for %o: %o', msg, reason);
        sendResponse({msg: msg, error: reason.message});
      });
    });

    return true;
  }
);
