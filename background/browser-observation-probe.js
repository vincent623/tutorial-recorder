export function inspectVisibleInteractivePage(options = {}) {
  const maxElements = clampInteger(options.maxElements, 1, 250, 80);
  const maxNodes = clampInteger(options.maxNodes, maxElements, 20_000, 5_000);
  const candidates = [];
  const roots = [document];
  const observedRegions = {
    openShadowDom: 0,
    sameOriginFrames: 0,
    crossOriginFrames: 0,
    inaccessibleFrames: 0,
    selfDrawnSurfaces: 0
  };
  let inspectedNodeCount = 0;
  let nodeLimitReached = false;

  while (roots.length && !nodeLimitReached) {
    const root = roots.shift();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let element = walker.nextNode();

    while (element) {
      inspectedNodeCount += 1;
      if (inspectedNodeCount >= maxNodes) {
        nodeLimitReached = true;
        break;
      }

      if (element.shadowRoot?.mode === 'open') {
        observedRegions.openShadowDom += 1;
      }

      if (element.matches('iframe, frame')) {
        classifyFrame(element, observedRegions);
      }
      if (element.matches('canvas')) {
        observedRegions.selfDrawnSurfaces += 1;
      }

      const observed = inspectElement(element);
      if (observed) {
        candidates.push(observed);
      }
      element = walker.nextNode();
    }
  }

  const unique = deduplicateCandidates(candidates);
  const selected = unique
    .sort((left, right) => right.priority - left.priority || left.rect.y - right.rect.y || left.rect.x - right.rect.x)
    .slice(0, maxElements)
    .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
    .map(({ priority, ...element }) => element);
  const truncated = nodeLimitReached || unique.length > maxElements;

  const documentToken = hash(`${performance.timeOrigin}|${location.href}`);
  const viewport = {
    width: innerWidth,
    height: innerHeight,
    scrollX,
    scrollY,
    devicePixelRatio: finiteNumber(globalThis.devicePixelRatio, 1),
    pageScaleFactor: finiteNumber(globalThis.visualViewport?.scale, 1),
    visualOffsetX: finiteNumber(globalThis.visualViewport?.offsetLeft, 0),
    visualOffsetY: finiteNumber(globalThis.visualViewport?.offsetTop, 0)
  };
  const revision = hash(JSON.stringify({
    documentToken,
    url: location.href,
    title: document.title,
    viewport,
    observedRegions,
    truncated,
    elements: selected
  }));

  return {
    documentToken,
    revision,
    url: location.href,
    title: document.title,
    viewport,
    observedRegions,
    elements: selected,
    truncated,
    inspectedNodeCount,
    degradedReasons: nodeLimitReached ? ['node-scan-limit-reached'] : []
  };

  function inspectElement(element) {
    const semantics = readSemantics(element);
    if (!semantics || !isVisibleAndActionable(element)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      role: semantics.role,
      name: readAccessibleName(element),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      fingerprint: fingerprintElement(element, semantics),
      targetType: semantics.targetType,
      targetRole: semantics.role,
      targetHref: element instanceof HTMLAnchorElement ? element.href : '',
      targetFormMethod: String(element.form?.method || '').toLowerCase(),
      priority: semantics.priority
    };
  }

  function classifyFrame(element, regions) {
    try {
      if (!element.contentDocument) {
        regions.crossOriginFrames += 1;
        return;
      }
      void element.contentDocument.location.href;
      regions.sameOriginFrames += 1;
    } catch {
      regions.inaccessibleFrames += 1;
    }
  }

  function readSemantics(element) {
    const tag = element.tagName.toLowerCase();
    const explicitRole = String(element.getAttribute('role') || '').toLowerCase();
    const inputType = tag === 'input'
      ? String(element.getAttribute('type') || 'text').toLowerCase()
      : '';
    if (tag === 'input' && inputType === 'hidden') {
      return null;
    }

    const explicitRoles = new Set([
      'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch',
      'combobox', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'option', 'slider', 'spinbutton', 'tab', 'treeitem'
    ]);
    let role = explicitRoles.has(explicitRole) ? explicitRole : '';
    let priority = role ? 80 : 0;

    if (!role && tag === 'button') role = 'button';
    if (!role && tag === 'a' && element.hasAttribute('href')) role = 'link';
    if (!role && tag === 'textarea') role = 'textbox';
    if (!role && tag === 'select') role = 'combobox';
    if (!role && tag === 'summary') role = 'button';
    if (!role && tag === 'input') {
      role = {
        button: 'button',
        submit: 'button',
        reset: 'button',
        checkbox: 'checkbox',
        radio: 'radio',
        range: 'slider',
        number: 'spinbutton',
        search: 'searchbox'
      }[inputType] || 'textbox';
    }
    if (!role && element.isContentEditable) role = 'textbox';
    if (!role && Number.parseInt(element.getAttribute('tabindex'), 10) >= 0) role = 'generic';
    if (!role) return null;

    if (['button', 'link', 'searchbox', 'textbox'].includes(role)) priority += 20;
    if (element === document.activeElement) priority += 30;
    if (element.closest('[role="dialog"], dialog[open], [aria-modal="true"]')) priority += 20;

    return { role, targetType: inputType || tag, priority };
  }

  function isVisibleAndActionable(element) {
    if (
      element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.closest('[inert]')
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      rect.width <= 2 ||
      rect.height <= 2 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= innerHeight ||
      rect.left >= innerWidth ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity || 1) <= 0 ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }

    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const root = element.getRootNode();
    const hit = typeof root.elementFromPoint === 'function'
      ? root.elementFromPoint(x, y)
      : document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element.contains(hit)));
  }

  function readAccessibleName(element) {
    const labelledBy = String(element.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ');
    const labelText = Array.from(element.labels || [])
      .map((label) => label.textContent || '')
      .join(' ');
    const acceptsUserText =
      element.isContentEditable ||
      ['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(
        String(element.getAttribute('role') || '').toLowerCase()
      ) ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement;
    return normalizeText(
      element.getAttribute('aria-label') ||
      labelledBy ||
      labelText ||
      element.getAttribute('title') ||
      element.getAttribute('placeholder') ||
      (acceptsUserText ? '' : element.innerText) ||
      ''
    ).slice(0, 240);
  }

  function fingerprintElement(element, semantics) {
    const path = [];
    let node = element;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const parent = node.parentElement;
      const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
      const stableName =
        node.id ||
        node.getAttribute?.('data-testid') ||
        node.getAttribute?.('data-id') ||
        node.getAttribute?.('name') ||
        '';
      path.unshift(`${node.tagName?.toLowerCase() || 'node'}:${siblingIndex}:${stableName}`);
      if (parent) {
        node = parent;
        continue;
      }
      const root = node.getRootNode?.();
      node = root?.host || null;
      if (node) path.unshift('#shadow');
    }
    return hash([
      path.join('>'),
      semantics.role,
      semantics.targetType,
      readAccessibleName(element),
      element.getAttribute('href') || '',
      element.form?.method || ''
    ].join('|'));
  }

  function deduplicateCandidates(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = [item.fingerprint, item.name, item.rect.x, item.rect.y, item.rect.width, item.rect.height].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }
}
