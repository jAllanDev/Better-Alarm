const DEFAULT_SETTINGS = {
  enabled: true,
  keywords: ["Cruise"],
  keyword: "Cruise",
  sound: "alarm",
  recurrent: false,
  volume: 80,
};

const CHECK_INTERVAL_MS = 15000;

const fields = {
  enabled: document.getElementById("enabled"),
  keywordCruise: document.getElementById("keywordCruise"),
  keywordWes: document.getElementById("keywordWes"),
  keywordWolf: document.getElementById("keywordWolf"),
  keywordGio: document.getElementById("keywordGio"),
  keywordCSFire: document.getElementById("keywordCSFire"),
  keywordVick: document.getElementById("keywordVick"),
  sound: document.getElementById("sound"),
  recurrent: document.getElementById("recurrent"),
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
  timer: document.getElementById("timer"),
  detectedSummary: document.getElementById("detectedSummary"),
  summary: document.getElementById("summary"),
  status: document.getElementById("status"),
  testSound: document.getElementById("testSound"),
  acknowledgeIssue: document.getElementById("acknowledgeIssue"),
};

const keywordFields = [
  fields.keywordCruise,
  fields.keywordWes,
  fields.keywordWolf,
  fields.keywordGio,
  fields.keywordCSFire,
  fields.keywordVick,
];

function setStatus(message) {
  fields.status.textContent = message;
}

function setTimer(message) {
  fields.timer.textContent = message;
}

function setSummary(message) {
  fields.summary.textContent = message;
}

function setDetectedSummary(message) {
  fields.detectedSummary.textContent = message;
}

function updateVolumeLabel(value) {
  fields.volumeValue.textContent = `${value}%`;
}

function getSelectedKeywords() {
  return keywordFields.filter((field) => field.checked).map((field) => field.value);
}

function setSelectedKeywords(selectedKeywords) {
  const selectedSet = new Set(selectedKeywords);
  keywordFields.forEach((field) => {
    field.checked = selectedSet.has(field.value);
  });
}

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      if (Array.isArray(settings.keywords)) {
        resolve(settings);
        return;
      }

      const migratedKeywords = typeof settings.keyword === "string" && settings.keyword.length > 0
        ? [settings.keyword]
        : DEFAULT_SETTINGS.keywords;

      resolve({ ...settings, keywords: migratedKeywords });
    });
  });
}

function writeSettings(nextSettings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(nextSettings, resolve);
  });
}

function readLocalState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        nextCheckAt: 0,
        lastScanSummary: "No keywords found",
        lastDetectedSummary: "",
        alarmActive: false,
        alarmKeyword: "",
      },
      resolve
    );
  });
}

function formatRemainingTime(nextCheckAt, enabled) {
  if (!enabled) {
    return "Monitoring is off.";
  }

  const targetTime = nextCheckAt || Date.now() + CHECK_INTERVAL_MS;
  const remainingMs = Math.max(0, targetTime - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  return `Next check in ${remainingSeconds}s`;
}

function startCountdownDisplay(initialNextCheckAt, enabled) {
  let nextCheckAt = initialNextCheckAt || (enabled ? Date.now() + CHECK_INTERVAL_MS : 0);

  const render = () => {
    setTimer(formatRemainingTime(nextCheckAt, enabled));
  };

  render();

  return setInterval(() => {
    if (!fields.enabled.checked) {
      setTimer("Monitoring is off.");
      return;
    }

    if (!nextCheckAt) {
      nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
    }

    if (Date.now() >= nextCheckAt) {
      nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
    }

    render();
  }, 1000);
}

async function persistFromUI() {
  const nextSettings = {
    enabled: fields.enabled.checked,
    keywords: getSelectedKeywords(),
    keyword: getSelectedKeywords()[0] || "",
    sound: fields.sound.value,
    recurrent: fields.recurrent.checked,
    volume: Number(fields.volume.value),
  };

  await writeSettings(nextSettings);
  setStatus(nextSettings.enabled ? "Monitoring is on." : "Monitoring is off.");
  updateVolumeLabel(nextSettings.volume);
}

async function testSound() {
  const settings = {
    enabled: fields.enabled.checked,
    keywords: getSelectedKeywords(),
    sound: fields.sound.value,
    recurrent: fields.recurrent.checked,
    volume: Number(fields.volume.value),
  };

  try {
    await chrome.runtime.sendMessage({
      action: "play-sound",
      sound: settings.sound,
      volume: settings.volume,
      title: "Sound preview",
      message: `Previewing ${settings.sound}.`,
    });
  } catch {
    setStatus("Sound preview could not be played.");
  }
}

async function init() {
  const settings = await readSettings();

  fields.enabled.checked = settings.enabled;
  setSelectedKeywords(settings.keywords);
  fields.sound.value = settings.sound;
  fields.recurrent.checked = Boolean(settings.recurrent);
  fields.volume.value = String(settings.volume);
  updateVolumeLabel(settings.volume);
  setStatus(settings.enabled ? "Monitoring is on." : "Monitoring is off.");

  fields.enabled.addEventListener("change", persistFromUI);
  keywordFields.forEach((field) => {
    field.addEventListener("change", persistFromUI);
  });
  fields.sound.addEventListener("change", persistFromUI);
  fields.recurrent.addEventListener("change", persistFromUI);
  fields.volume.addEventListener("input", () => {
    updateVolumeLabel(Number(fields.volume.value));
  });
  fields.volume.addEventListener("change", persistFromUI);
  fields.testSound.addEventListener("click", testSound);
  fields.acknowledgeIssue.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "acknowledge-issue" });
    setStatus("Issue acknowledged.");
  });

  const localState = await readLocalState();
  setDetectedSummary(localState.lastDetectedSummary ? `Last found: ${localState.lastDetectedSummary}` : "Last found: No keywords detected yet");
  setSummary(localState.lastScanSummary || "No keywords found");
  fields.summary.classList.toggle("active", localState.lastScanSummary !== "No keywords found");
  fields.summary.classList.toggle("dimmed", localState.lastScanSummary === "No keywords found");
  fields.acknowledgeIssue.disabled = !localState.alarmActive;
  fields.acknowledgeIssue.classList.toggle("secondary", !localState.alarmActive);
  if (localState.alarmActive && localState.alarmKeyword) {
    setStatus(`Alarm active for ${localState.alarmKeyword}.`);
  }
  startCountdownDisplay(localState.nextCheckAt, fields.enabled.checked);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.lastScanSummary) {
      const summary = changes.lastScanSummary.newValue || "No keywords found";
      setSummary(summary);
      fields.summary.classList.toggle("active", summary !== "No keywords found");
      fields.summary.classList.toggle("dimmed", summary === "No keywords found");
    }

    if (changes.lastDetectedSummary) {
      const summary = changes.lastDetectedSummary.newValue || "";
      setDetectedSummary(summary ? `Last found: ${summary}` : "Last found: No keywords detected yet");
    }

    if (changes.nextCheckAt && fields.enabled.checked) {
      setTimer(formatRemainingTime(changes.nextCheckAt.newValue, true));
    }

    if (changes.alarmActive) {
      const active = Boolean(changes.alarmActive.newValue);
      fields.acknowledgeIssue.disabled = !active;
      fields.acknowledgeIssue.classList.toggle("secondary", !active);
      if (active && changes.alarmKeyword?.newValue) {
        setStatus(`Alarm active for ${changes.alarmKeyword.newValue}.`);
      }
    }
  });
}

init().catch((error) => {
  setStatus(`Unable to load settings: ${error.message}`);
});
