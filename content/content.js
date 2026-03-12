console.log('[Content] Feedback layer loaded');

let lastInteractionFingerprint = '';
let lastInteractionAt = 0;

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

document.addEventListener('click', (event) => {
  reportInteraction('click', event.target);
}, true);

document.addEventListener('change', (event) => {
  reportInteraction('change', event.target);
}, true);

document.addEventListener('submit', (event) => {
  reportInteraction('submit', event.target);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  reportInteraction('keydown', event.target, { key: event.key });
}, true);

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

  if (navigator.userActivation && !navigator.userActivation.isActive) {
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

function reportInteraction(type, target, extra = {}) {
  const summary = buildInteractionSummary(type, target, extra);
  if (!summary) {
    return;
  }

  const now = Date.now();
  const fingerprint = `${type}:${summary}`;
  if (fingerprint === lastInteractionFingerprint && now - lastInteractionAt < 600) {
    return;
  }

  lastInteractionFingerprint = fingerprint;
  lastInteractionAt = now;

  chrome.runtime
    .sendMessage({
      action: 'recordInteraction',
      payload: {
        type,
        summary,
        target: describeTarget(target),
        timestamp: now
      }
    })
    .catch(() => {});
}

function buildInteractionSummary(type, target, extra = {}) {
  const label = describeTarget(target);
  if (!label) {
    return '';
  }

  if (type === 'click') {
    return `点击${label}`;
  }

  if (type === 'submit') {
    return `提交${label}`;
  }

  if (type === 'keydown' && extra.key === 'Enter') {
    return `在${label}中确认输入`;
  }

  if (type === 'change') {
    const element = getDescribedElement(target);
    if (element?.matches('input[type="checkbox"], input[type="radio"]')) {
      return `切换${label}`;
    }

    return `修改${label}`;
  }

  return '';
}

function describeTarget(target) {
  const element = getDescribedElement(target);
  if (!element) {
    return '';
  }

  const tagName = element.tagName.toLowerCase();
  const candidates = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('placeholder'),
    element.getAttribute('name'),
    element.getAttribute('data-testid'),
    tagName === 'input' || tagName === 'textarea' ? element.value : '',
    normalizeText(element.innerText),
    normalizeText(element.textContent),
    getLabelText(element)
  ].filter(Boolean);

  const label = normalizeText(candidates[0] || '');
  if (!label) {
    return fallbackTargetName(element);
  }

  return label.length > 36 ? `${label.slice(0, 36)}...` : label;
}

function getDescribedElement(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return (
    target.closest(
      'button, a, input, textarea, select, summary, details, label, [role="button"], [aria-label], [data-testid]'
    ) || target
  );
}

function getLabelText(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label) {
      return normalizeText(label.textContent);
    }
  }

  return normalizeText(element.closest('label')?.textContent || '');
}

function fallbackTargetName(element) {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return '输入控件';
  }

  if (tagName === 'button' || element.getAttribute('role') === 'button') {
    return '按钮';
  }

  if (tagName === 'a') {
    return '链接';
  }

  return '页面元素';
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
