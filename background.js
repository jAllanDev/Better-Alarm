const OFFSCREEN_URL = "offscreen.html";
const RECURRING_AUDIO_INTERVAL_MS = 900;

let offscreenReadyResolve = null;
let offscreenReadyPromise = Promise.resolve();

let activeAlarmState = {
  active: false,
  recurrent: false,
  keyword: "",
  sound: "alarm",
  volume: 80,
};

async function hasOffscreenDocument() {
  if (!chrome.offscreen?.hasDocument) {
    return false;
  }

  return chrome.offscreen.hasDocument();
}

async function ensureOffscreenDocument() {
  const alreadyOpen = await hasOffscreenDocument();
  if (alreadyOpen) {
    return;
  }

  offscreenReadyPromise = new Promise((resolve) => {
    offscreenReadyResolve = resolve;
  });

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play notification sounds when a keyword is found on a page.",
  });
}

async function waitForOffscreenReady() {
  await ensureOffscreenDocument();
  await Promise.race([
    offscreenReadyPromise,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

async function playAlert(message) {
  await waitForOffscreenReady();
  await chrome.runtime.sendMessage({
    action: "play-audio",
    sound: message.sound,
    volume: message.volume,
  });
}

async function startRecurringAlarm(message) {
  activeAlarmState = {
    active: true,
    recurrent: true,
    keyword: message.keyword,
    sound: message.sound,
    volume: message.volume,
  };

  await chrome.storage.local.set({
    alarmActive: true,
    alarmKeyword: message.keyword,
    alarmSummary: message.keyword,
  });
  await waitForOffscreenReady();
  await chrome.runtime.sendMessage({
    action: "start-recurring-audio",
    sound: message.sound,
    volume: message.volume,
    intervalMs: RECURRING_AUDIO_INTERVAL_MS,
  });
}

async function stopRecurringAlarm() {
  activeAlarmState = {
    active: false,
    recurrent: false,
    keyword: "",
    sound: "alarm",
    volume: 80,
  };

  await chrome.storage.local.set({
    alarmActive: false,
    alarmKeyword: "",
    alarmSummary: "",
  });
  await waitForOffscreenReady();
  await chrome.runtime.sendMessage({ action: "stop-recurring-audio" });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    {
      enabled: true,
        keywords: ["Cruise"],
        keyword: "Cruise",
      sound: "alarm",
      recurrent: false,
      volume: 80,
    },
    (settings) => {
      chrome.storage.sync.set(settings);
    }
  );
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "offscreen-ready") {
    if (offscreenReadyResolve) {
      offscreenReadyResolve();
      offscreenReadyResolve = null;
    }
    return;
  }

  if (message.action === "keyword-found") {
    const notificationId = `keyword-${Date.now()}-${sender.tab?.id ?? "tab"}`;
    chrome.notifications.create(notificationId, {
      type: "basic",
      title: `Keyword found: ${message.keyword}`,
      message: `${message.keyword} appeared on ${message.title || "the page"}.`,
      iconUrl: chrome.runtime.getURL("icon.svg"),
    });

    chrome.storage.sync.get({ recurrent: false }, (settings) => {
      if (settings.recurrent) {
        startRecurringAlarm(message).catch(() => {
          // If recurrent mode fails, the one-shot alert still happened.
        });
      } else {
        playAlert(message).catch(() => {
          // Sound playback is best-effort; notifications still fire.
        });
        chrome.storage.local.set({
          alarmActive: true,
          alarmKeyword: message.keyword,
          alarmSummary: message.keyword,
        });
      }
    });
  }

  if (message.action === "play-sound") {
    playAlert(message).catch(() => {
      // Preview failures are non-fatal for the popup.
    });
  }

  if (message.action === "acknowledge-issue") {
    stopRecurringAlarm().catch(() => {
      // The UI should still clear even if audio teardown is imperfect.
    });
  }
});
