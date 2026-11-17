const ALLOWED_KEYWORDS = ["Wes", "Cruise", "Wolf", "Gio", "Fire22"];
const DEFAULT_SETTINGS = {
  enabled: true,
  keywords: ["Wes", "Cruise"],
  keyword: "Wes",
  sound: "alarm",
  volume: 80,
};

const CHECK_INTERVAL_MS = 15000;

let activeSettings = { ...DEFAULT_SETTINGS };
let timerId = null;
let lastMatchState = false;

if (!/^([a-z0-9-]+\.)?sportswebhost\.com$/i.test(location.hostname)) {
  throw new Error("Keyword Alarm Notifier is restricted to sportswebhost.com");
}

function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    return [];
  }

  const result = [];
  keywords.forEach((keyword) => {
    const cleaned = typeof keyword === "string" ? keyword.trim() : "";
    if (!cleaned || result.includes(cleaned) || !ALLOWED_KEYWORDS.includes(cleaned)) {
      return;
    }

    result.push(cleaned);
  });

  return result;
}

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      const normalizedKeywords = normalizeKeywords(Array.isArray(settings.keywords) ? settings.keywords : (typeof settings.keyword === "string" && settings.keyword.length > 0 ? [settings.keyword] : DEFAULT_SETTINGS.keywords));

      resolve({
        ...settings,
        keywords: normalizedKeywords.length > 0 ? normalizedKeywords : DEFAULT_SETTINGS.keywords,
        keyword: normalizedKeywords[0] || DEFAULT_SETTINGS.keyword,
      });
    });
  });
}

function sendKeywordHit() {
  chrome.runtime.sendMessage({
    action: "keyword-found",
    keyword: activeSettings.keywords.join(", "),
    keywords: activeSettings.keywords,
    sound: activeSettings.sound,
    volume: activeSettings.volume,
    title: document.title || "Keyword detected",
    url: location.href,
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text, keyword) {
  const escapedKeyword = escapeRegExp(keyword.trim());

  if (!escapedKeyword) {
    return 0;
  }

  const pattern = new RegExp(escapedKeyword, "gi");
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function updateNextCheckTime() {
  chrome.storage.local.set({ nextCheckAt: Date.now() + CHECK_INTERVAL_MS });
}

function collectTextFromElement(element, chunks) {
  if (!element) {
    return;
  }

  const labelCandidates = [
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title"),
    element.getAttribute?.("alt"),
    element.getAttribute?.("placeholder"),
    element.value,
  ];

  labelCandidates.forEach((value) => {
    if (typeof value === "string" && value.trim()) {
      chunks.push(value);
    }
  });

  if (element.shadowRoot) {
    collectSearchableText(element.shadowRoot, chunks);
  }

  if (element.tagName === "IFRAME") {
    try {
      const frameDocument = element.contentDocument;
      if (frameDocument) {
        collectSearchableText(frameDocument, chunks);
      }
    } catch {
      // Cross-origin frames are ignored.
    }
  }
}

function collectSearchableText(root, chunks) {
  if (!root) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      const text = currentNode.textContent?.trim();
      if (text) {
        chunks.push(text);
      }
    } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
      const element = currentNode;

      if (element.tagName === "SCRIPT" || element.tagName === "STYLE" || element.tagName === "NOSCRIPT") {
        currentNode = walker.nextNode();
        continue;
      }

      if (element.tagName === "BUTTON" || element.tagName === "A" || element.tagName === "LABEL" || element.tagName === "INPUT" || element.getAttribute("role") === "button") {
        collectTextFromElement(element, chunks);
      }

      if (element.shadowRoot) {
        collectSearchableText(element.shadowRoot, chunks);
      }

      if (element.tagName === "IFRAME") {
        collectTextFromElement(element, chunks);
      }
    }

    currentNode = walker.nextNode();
  }
}

function collectButtonTexts(root) {
  const texts = [];

  if (!root) {
    return texts;
  }

  const selectors = [
    "button",
    "[role='button']",
    "a",
    "label",
    "input",
    ".v-btn",
    ".v-btn__content",
    ".v-chip",
    ".v-list-item",
    ".v-tab",
  ].join(",");

  root.querySelectorAll?.(selectors).forEach((element) => {
    const elementText = [
      element.innerText,
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("alt"),
      element.getAttribute?.("placeholder"),
      element.value,
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ");

    if (elementText.trim()) {
      texts.push(elementText);
    }

    if (element.shadowRoot) {
      texts.push(...collectButtonTexts(element.shadowRoot));
    }
  });

  return texts;
}

function collectPageText() {
  const root = document.body || document.documentElement;

  if (!root) {
    return "";
  }

  const chunks = [];
  collectSearchableText(root, chunks);
  chunks.push(...collectButtonTexts(root));

  return chunks.join(" ");
}

function scanPage() {
  if (!activeSettings.enabled) {
    lastMatchState = false;
    chrome.storage.local.set({ nextCheckAt: 0 });
    chrome.storage.local.set({ lastScanSummary: "Monitoring is off." });
    return;
  }

  const pageText = collectPageText().toLowerCase();
  const selectedKeywords = normalizeKeywords(activeSettings.keywords);
  const detections = selectedKeywords
    .map((keyword) => ({
      keyword,
      count: countOccurrences(pageText, keyword.toLowerCase()),
    }))
    .filter((entry) => entry.count > 0);

  const isMatch = detections.length > 0;
  const summaryText = isMatch
    ? detections.map((entry) => `${entry.keyword} detected (${entry.count})`).join(", ")
    : "No keywords found";

  if (isMatch && !lastMatchState) {
    sendKeywordHit();
  }

  chrome.storage.local.set({
    lastScanSummary: summaryText,
    ...(isMatch ? { lastDetectedSummary: summaryText, lastDetectedAt: Date.now() } : {}),
  });

  lastMatchState = isMatch;
  updateNextCheckTime();
}

function startTimer() {
  stopTimer();
  if (!activeSettings.enabled) {
    chrome.storage.local.set({ nextCheckAt: 0 });
    return;
  }

  updateNextCheckTime();
  scanPage();
  timerId = setInterval(scanPage, 15000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

async function syncSettings() {
  activeSettings = await readSettings();
  startTimer();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  if (changes.enabled || changes.keywords || changes.sound || changes.volume) {
    syncSettings();
  }
});

syncSettings();
