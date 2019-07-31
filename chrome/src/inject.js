let counter = 0;
let pendingDiffs = [];
let filesCache = new Map();
let startTime;
let startAugmentTime;

function injectUrl(counter, node, currentOffset, startOffset, endOffset, url) {
  if (!node.hasChildNodes()) {
    if (node.nodeType !== Node.TEXT_NODE) {
      return currentOffset;
    }

    const newCurrentOffset = currentOffset + node.data.length;
    if (newCurrentOffset === currentOffset) {
      return newCurrentOffset;
    }

    startOffset = Math.max(startOffset, currentOffset);
    endOffset = Math.min(endOffset, newCurrentOffset);
    if (endOffset <= startOffset) {
      return newCurrentOffset;
    }

    const leftLength = startOffset - currentOffset;
    if (leftLength > 0) {
      // There is a non-linked left part
      node = node.splitText(leftLength);
    }

    const rightLength = newCurrentOffset - endOffset;
    if (rightLength > 0) {
      // There is a non-linked right part
      const linkedLength = endOffset - startOffset;
      node.splitText(linkedLength);
    }

    const parent = node.parentNode;
    if (parent) {
      const a = document.createElement('a');
      a.setAttribute('data-gotodev', counter);
      a.href = url;
      parent.replaceChild(a, node);
      a.appendChild(node);
    }

    return newCurrentOffset;
  }

  // Children will be added during the loop's iteration,
  // so we need to make a copy of it and not simply held
  // a reference to not risk an infinite loop.
  const children = Array.from(node.childNodes);

  // If needed, first hoist all children to undo previous injection
  if (node.hasAttribute('data-gotodev') && node.getAttribute('data-gotodev') != counter) {
    const parent = node.parentNode;
    if (parent) {
      for (const child of children) {
        parent.insertBefore(child, node);
      }
      parent.removeChild(node);
    }
  }

  // New injection
  for (const child of children) {
    currentOffset = injectUrl(counter, child, currentOffset, startOffset, endOffset, url);
  }

  return currentOffset;
}

function augmentBlob(counter, syms) {
  for (const sym of syms) {
    if (sym.startLine !== sym.endLine) {
      continue;
    }

    const escapedLine = +sym.startLine; // Cast to number with unary plus
    const line = document.getElementById('LC' + escapedLine);
    if (!line) {
      continue;
    }

    injectUrl(counter, line, 0, sym.startOffset, sym.endOffset, sym.url);
  }
}

function renderPendingDiff(pendingDiff) {
  const path = pendingDiff.path;
  const type = pendingDiff.type;
  const sym = pendingDiff.sym;

  if (sym.startLine !== sym.endLine) {
    return;
  }

  let file = filesCache.get(path);
  if (!file) {
    const escapedPath = path.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
    file = document.querySelector(`div.file-header[data-path = '${escapedPath}'] + div.js-file-content`);
    filesCache.set(path, file);
  }
  if (!file) {
    return;
  }

  const escapedLine = +sym.startLine; // Cast to number with unary plus
  let selector;
  if (type === 'old') {
    selector = `td[data-line-number='${escapedLine}']:first-child ~ td.blob-code > span.blob-code-inner`;
  } else if (type === 'new') {
    selector = `td[data-line-number='${escapedLine}']:not(:first-child) ~ td.blob-code > span.blob-code-inner`;
  } else {
    console.error('[goto.dev] Unsupported diff type: %o', type);
    return;
  }
  const line = file.querySelector(selector);
  if (!line) {
    return;
  }

  injectUrl(pendingDiff.counter, line, 0, sym.startOffset, sym.endOffset, sym.url);
}

function renderPendingDiffs(taskStartTime) {
  const batchSize = 64;

  let first = false;
  for (let i = 0; i < batchSize; i++) {
    let diff = pendingDiffs.pop();
    if (!diff) {
      break;
    }
    first = diff.first;
    renderPendingDiff(diff);
  }

  if (pendingDiffs.length > 0) {
    requestAnimationFrame(renderPendingDiffs);
  } else if (first) {
    // First-In Last-Out: First symbol was processed, finished
    const now = window.performance.now();
    console.log('[goto.dev] Augmenting completed in: %dms', now - startAugmentTime);
    console.log('[goto.dev] End-to-end time: %dms', now - startTime);
  } else {
    console.log('[goto.dev] Augmenting interrupted by new request');
  }
}

function augmentDiff(counter, diff) {
  let first = true;

  for (const newFile of diff.newFiles) {
    for (const sym of newFile.syms) {
      pendingDiffs.push({
        'counter': counter,
        'first': first,
        'path': newFile.path,
        'type': 'new',
        'sym': sym,
      });
      first = false;
    }
  }

  for (const oldFile of diff.oldFiles) {
    for (const sym of oldFile.syms) {
      pendingDiffs.push({
        'counter': counter,
        'first': first,
        'path': oldFile.path,
        'type': 'old',
        'sym': sym,
      });
      first = false;
    }
  }

  if (pendingDiffs.length > 0) {
    startAugmentTime = window.performance.now();
    requestAnimationFrame(renderPendingDiffs);
  }
}

function augmentPage() {
  let linkUrl;
  let element;
  if ((element = document.querySelector('.js-permalink-shortcut')) && element.href) {
    linkUrl = element.href;
  } else if ((element = document.querySelector('.toc-select > details-menu')) && element.getAttribute('src')) {
    linkUrl = element.getAttribute('src');
  } else {
    return;
  }

  let msg;
  let matches;
  if (matches = linkUrl.match('^https://github.com/([^/]+/[^/]+)/blob/([^/]+)/(.+)$')) {
    const [_, slug, commit, path] = matches;
    msg = {type: 'blob', slug: slug, commit: commit, path: path};
  } else if (matches = linkUrl.match('^https://github.com/([^/]+/[^/]+)/commit/([^/]+)$')) {
    const [_, slug, commit] = matches;
    msg = {type: 'commit', slug: slug, commit: commit};
  } else if (matches = linkUrl.match('^/([^/]+/[^/]+)/pull/([0-9]+)/show_toc\\?base_sha=([0-9a-fA-F]+)&sha1=([0-9a-fA-F]+)&sha2=([0-9a-fA-F]+)$')) {
    const [_, slug, id, baseSha, oldSha, newSha] = matches;
    msg = {type: 'pr', slug: slug, id: id, base: baseSha, old: oldSha, new: newSha};
  } else {
    return;
  }

  counter++;
  msg.counter = counter;
  pendingDiffs = [];
  filesCache.clear();
  startTime = window.performance.now();

  console.log('[goto.dev] Resolving reference for: %o', msg);

  chrome.runtime.sendMessage(msg, function(response) {
    console.log('[goto.dev] Received server response in: %dms', window.performance.now() - startTime);

    if (response === undefined) {
      console.log('[goto.dev] Undefined response');
      return;
    }

    if (counter != msg.counter) {
      // Outdated message
      console.log('[goto.dev] Ignoring outdated server response: %o', response);
      return;
    }

    const error = response.error;
    if (error !== undefined) {
      console.log('[goto.dev] ERROR %s', error);
      return;
    }

    const result = response.result;
    if (result === undefined) {
      console.log('[goto.dev] ERROR Invalid response: %o', response);
      return;
    }

    if (result.syms !== undefined && Array.isArray(result.syms)) {
      console.log('[goto.dev] Resolved %d symbols: %o', result.syms.length, result);
      augmentBlob(msg.counter, result.syms);
    } else {
      console.log('[goto.dev] Resolved %d new files and %d old ones: %o', result.newFiles.length, result.oldFiles.length, result);
      augmentDiff(msg.counter, result);
    }
  });
}

augmentPage();

const mainElement = document.querySelector('main');
if (mainElement) {
  new MutationObserver((mutationsList, observer) => {
    augmentPage();
  }).observe(
    mainElement,
    {
      characterData: true,
      childList: true,
    }
  )
}
