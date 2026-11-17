let audioContext = null;
let recurringTimerId = null;
let recurringSound = {
  sound: "alarm",
  volume: 80,
};

chrome.runtime.sendMessage({ action: "offscreen-ready" });

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

function createGainNode(context, volume) {
  const gainNode = context.createGain();
  gainNode.gain.value = Math.max(0, Math.min(1, volume / 100));
  gainNode.connect(context.destination);
  return gainNode;
}

function playTone(context, gainNode, frequency, startTime, duration, type = "sine") {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.connect(gainNode);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

async function playSound({ sound, volume }) {
  const context = getAudioContext();
  await context.resume();

  const now = context.currentTime;
  const gainNode = createGainNode(context, volume);

  if (sound === "chime") {
    playTone(context, gainNode, 880, now, 0.14, "sine");
    playTone(context, gainNode, 1320, now + 0.16, 0.18, "sine");
    return;
  }

  if (sound === "siren") {
    const oscillator = context.createOscillator();
    const sirenGain = createGainNode(context, volume);
    oscillator.type = "triangle";
    oscillator.connect(sirenGain);
    oscillator.frequency.setValueAtTime(720, now);
    oscillator.frequency.linearRampToValueAtTime(1280, now + 0.35);
    oscillator.frequency.linearRampToValueAtTime(720, now + 0.7);
    oscillator.frequency.linearRampToValueAtTime(1280, now + 1.05);
    oscillator.frequency.linearRampToValueAtTime(720, now + 1.4);
    oscillator.start(now);
    oscillator.stop(now + 1.45);
    return;
  }

  for (let index = 0; index < 5; index += 1) {
    const start = now + index * 0.18;
    const frequency = index % 2 === 0 ? 950 : 650;
    playTone(context, gainNode, frequency, start, 0.14, "square");
  }
}

function stopRecurringSound() {
  if (recurringTimerId) {
    clearInterval(recurringTimerId);
    recurringTimerId = null;
  }
}

async function startRecurringSound({ sound, volume, intervalMs }) {
  stopRecurringSound();
  recurringSound = { sound, volume };

  await playSound(recurringSound);
  recurringTimerId = setInterval(() => {
    playSound(recurringSound).catch(() => {
      // Ignore transient audio failures while the alarm is active.
    });
  }, intervalMs || 900);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "play-audio") {
    playSound(message).catch(() => {
      // Intentionally ignore audio errors so the extension stays responsive.
    });
  }

  if (message.action === "start-recurring-audio") {
    startRecurringSound(message).catch(() => {
      // If recurrence fails, the background notification still exists.
    });
  }

  if (message.action === "stop-recurring-audio") {
    stopRecurringSound();
  }
});
