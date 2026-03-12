console.log('[Content] Feedback layer loaded');

chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case 'screenshotFeedback':
      showFeedback(`已截图 (${message.count})`, '#1677ff');
      playBeep(880);
      break;
    case 'recordingStarted':
      showFeedback('录制开始', '#52c41a');
      break;
    case 'recordingPaused':
      showFeedback('录制已暂停', '#faad14');
      break;
    case 'recordingResumed':
      showFeedback('录制继续', '#52c41a');
      break;
    case 'recordingStopped':
      showFeedback('录制已停止', '#ff4d4f');
      break;
    default:
      break;
  }
});

function showFeedback(text, backgroundColor) {
  const existing = document.getElementById('tr-feedback');
  if (existing) {
    existing.remove();
  }

  const feedback = document.createElement('div');
  feedback.id = 'tr-feedback';
  feedback.textContent = text;
  feedback.style.cssText = [
    'position:fixed',
    'top:20px',
    'right:20px',
    'z-index:2147483647',
    `background:${backgroundColor}`,
    'color:#ffffff',
    'padding:12px 18px',
    'border-radius:12px',
    'font:600 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'box-shadow:0 12px 30px rgba(15, 23, 42, 0.22)',
    'animation:trSlideIn 180ms ease-out'
  ].join(';');

  (document.body || document.documentElement).appendChild(feedback);
  ensureStyle();

  setTimeout(() => {
    feedback.style.transition = 'opacity 220ms ease';
    feedback.style.opacity = '0';
    setTimeout(() => feedback.remove(), 240);
  }, 1800);
}

function ensureStyle() {
  if (document.getElementById('tr-feedback-style')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'tr-feedback-style';
  style.textContent = `
    @keyframes trSlideIn {
      from {
        opacity: 0;
        transform: translate3d(0, -10px, 0);
      }
      to {
        opacity: 1;
        transform: translate3d(0, 0, 0);
      }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function playBeep(frequency) {
  if (!window.AudioContext && !window.webkitAudioContext) {
    return;
  }

  const Context = window.AudioContext || window.webkitAudioContext;
  const audioContext = new Context();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  gainNode.gain.value = 0.05;

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();

  setTimeout(() => {
    oscillator.stop();
    audioContext.close().catch(() => {});
  }, 120);
}
