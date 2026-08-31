export function installBrowserObservationProbeHelpers(persist = true) {
  const key = '__tutorialRecorderBrowserObservationProbeHelpersV1';
  if (persist && globalThis[key]) return globalThis[key];

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

  function normalizeRegion(region) {
    if (!region || typeof region !== 'object') return null;
    const normalized = {
      x: finiteNumber(region.x, 0),
      y: finiteNumber(region.y, 0),
      width: Math.max(0, finiteNumber(region.width, 0)),
      height: Math.max(0, finiteNumber(region.height, 0))
    };
    return normalized.width > 0 && normalized.height > 0 ? normalized : null;
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  }
  function readEffectiveFormDestination(element) {
    const form = element?.form || null;
    if (!form) return { action: '', method: '' };
    const isSubmitter = Boolean(element.matches?.('button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]'));
    const canReadAttributes = typeof element.hasAttribute === 'function';
    const hasActionOverride = isSubmitter && (canReadAttributes ? element.hasAttribute('formaction') : Boolean(element.formAction));
    const hasMethodOverride = isSubmitter && (canReadAttributes ? element.hasAttribute('formmethod') : Boolean(element.formMethod));
    return { action: String(hasActionOverride ? element.formAction : form.action || ''), method: String(hasMethodOverride ? element.formMethod : form.method || '').toLowerCase() };
  }
  function describeNode(element) {
    return [
      element.tagName.toLowerCase(),
      element.id,
      element.getAttribute('name'),
      element.getAttribute('title')
    ].map((value) => normalizeText(value).slice(0, 80)).join(':');
  }

  function describeFrame(element) {
    let documentIdentity = '';
    try {
      const frameView = element.contentWindow;
      documentIdentity = hash(`${frameView.performance.timeOrigin}|${frameView.location.href}`);
    } catch {
      documentIdentity = 'inaccessible';
    }
    return `${describeNode(element)}:${documentIdentity}`;
  }

  function hasUnsupportedFrameTransform(element) {
    let node = element;
    while (node) {
      const transform = node.ownerDocument.defaultView.getComputedStyle(node).transform;
      if (transform && transform !== 'none') {
        const matrix = transform.match(/^matrix\(([^)]+)\)$/);
        if (!matrix) return true;
        const values = matrix[1].split(',').map(Number);
        if (
          values.length !== 6 || values[0] <= 0 || values[3] <= 0 ||
          Math.abs(values[1]) > 0.0001 || Math.abs(values[2]) > 0.0001
        ) return true;
      }
      const root = node.getRootNode?.();
      node = node.parentElement || root?.host || null;
    }
    return false;
  }

  function toGlobalRect(rect, context) {
    return {
      x: context.offsetX + rect.left * context.scaleX,
      y: context.offsetY + rect.top * context.scaleY,
      width: rect.width * context.scaleX,
      height: rect.height * context.scaleY
    };
  }

  function intersectRects(left, right) {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const rightEdge = Math.min(left.x + left.width, right.x + right.width);
    const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
    if (rightEdge <= x || bottomEdge <= y) return null;
    return { x, y, width: rightEdge - x, height: bottomEdge - y };
  }

  function rectsIntersect(left, right) {
    return Boolean(intersectRects(left, right));
  }

  function composedContains(container, element) {
    let node = element;
    while (node) {
      if (node === container) return true;
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      const root = node.getRootNode?.();
      if (root?.host) {
        node = root.host;
        continue;
      }
      try {
        node = node.ownerDocument?.defaultView?.frameElement || null;
      } catch {
        node = null;
      }
    }
    return false;
  }

  function findActiveModal(rootDocument, traverseFrames = true) {
    const rootsToInspect = [{ root: rootDocument, frameAncestors: [] }];
    const candidates = [];
    while (rootsToInspect.length) {
      const { root, frameAncestors } = rootsToInspect.shift();
      candidates.push(...Array.from(
        root.querySelectorAll('dialog[open], [aria-modal="true"]'),
        (element) => ({ element, frameAncestors })
      ));
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot?.mode === 'open') {
          rootsToInspect.push({ root: element.shadowRoot, frameAncestors });
        }
        if (traverseFrames && element.matches('iframe, frame')) {
          try {
            if (element.contentDocument) {
              rootsToInspect.push({
                root: element.contentDocument,
                frameAncestors: [...frameAncestors, element]
              });
            }
          } catch {
            // Cross-origin frames remain outside the accessible modal scope.
          }
        }
      }
    }
    return candidates.reverse().find(({ element, frameAncestors }) => {
      const rect = element.getBoundingClientRect();
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return rect.width > 2 && rect.height > 2 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 &&
        isPageModalFrameChain(frameAncestors);
    })?.element || null;
  }

  function isPageModalFrameChain(frameAncestors) {
    if (!frameAncestors.length) return true;
    const outerFrame = frameAncestors[0];
    if (!outerFrame.matches('dialog, [role="dialog"], [aria-modal="true"]')) return false;
    return frameAncestors.every((frame) => {
      const rect = frame.getBoundingClientRect();
      const view = frame.ownerDocument.defaultView;
      const style = view.getComputedStyle(frame);
      if (
        rect.width <= 2 || rect.height <= 2 || rect.right <= 0 || rect.bottom <= 0 ||
        rect.left >= view.innerWidth || rect.top >= view.innerHeight ||
        style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0
      ) return false;
      const root = frame.getRootNode();
      const x = Math.min(view.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(view.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const hit = typeof root.elementFromPoint === 'function'
        ? root.elementFromPoint(x, y)
        : frame.ownerDocument.elementFromPoint(x, y);
      return Boolean(hit && (hit === frame || frame.contains(hit)));
    });
  }

  function buildInitialContext() {
    const localFallback = () => ({
      root: document,
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      clip: { x: 0, y: 0, width: innerWidth, height: innerHeight },
      framePath: [],
      shadowPath: [],
      frameAncestors: [],
      sameOriginToTop: false,
      topDocument: null
    });
    try {
      const frameElements = [];
      let currentWindow = globalThis;
      while (currentWindow !== currentWindow.top) {
        const frameElement = currentWindow.frameElement;
        if (!frameElement) return localFallback();
        frameElements.unshift(frameElement);
        currentWindow = currentWindow.parent;
        void currentWindow.document.location.href;
      }
      let context = {
        root: currentWindow.document,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
        clip: { x: 0, y: 0, width: currentWindow.innerWidth, height: currentWindow.innerHeight },
        framePath: [],
        shadowPath: [],
        frameAncestors: [],
        sameOriginToTop: true,
        topDocument: currentWindow.document
      };
      for (const frameElement of frameElements) {
        const frameRect = toGlobalRect(frameElement.getBoundingClientRect(), context);
        const childClip = intersectRects(context.clip, frameRect);
        if (!childClip || hasUnsupportedFrameTransform(frameElement)) return localFallback();
        const scaleX = frameRect.width / Math.max(1, finiteNumber(frameElement.offsetWidth, frameRect.width));
        const scaleY = frameRect.height / Math.max(1, finiteNumber(frameElement.offsetHeight, frameRect.height));
        context = {
          root: frameElement.contentDocument,
          offsetX: frameRect.x + finiteNumber(frameElement.clientLeft, 0) * scaleX,
          offsetY: frameRect.y + finiteNumber(frameElement.clientTop, 0) * scaleY,
          scaleX,
          scaleY,
          clip: childClip,
          framePath: [...context.framePath, describeFrame(frameElement)],
          shadowPath: [],
          frameAncestors: [...context.frameAncestors, { element: frameElement, parentContext: context }],
          sameOriginToTop: true,
          topDocument: currentWindow.document
        };
      }
      return { ...context, root: document };
    } catch {
      return localFallback();
    }
  }

  function createFrameContext(element, parentContext, regions, documentTokens) {
    const frameRect = toGlobalRect(element.getBoundingClientRect(), parentContext);
    const childClip = intersectRects(parentContext.clip, frameRect);
    if (!childClip) return null;
    if (hasUnsupportedFrameTransform(element)) {
      regions.transformedFrames += 1;
      return null;
    }
    try {
      if (!element.contentDocument) {
        regions.crossOriginFrames += 1;
        return null;
      }
      void element.contentDocument.location.href;
      regions.sameOriginFrames += 1;
      const scaleX = frameRect.width / Math.max(1, finiteNumber(element.offsetWidth, frameRect.width));
      const scaleY = frameRect.height / Math.max(1, finiteNumber(element.offsetHeight, frameRect.height));
      const frameDescriptor = describeFrame(element);
      documentTokens.push(frameDescriptor);
      return {
        root: element.contentDocument,
        offsetX: frameRect.x + finiteNumber(element.clientLeft, 0) * scaleX,
        offsetY: frameRect.y + finiteNumber(element.clientTop, 0) * scaleY,
        scaleX,
        scaleY,
        clip: childClip,
        framePath: [...parentContext.framePath, frameDescriptor],
        shadowPath: [],
        frameAncestors: [...parentContext.frameAncestors, { element, parentContext }],
        sameOriginToTop: parentContext.sameOriginToTop,
        topDocument: parentContext.topDocument
      };
    } catch {
      regions.inaccessibleFrames += 1;
      return null;
    }
  }

  function readSemantics(element) {
    const tag = element.tagName.toLowerCase();
    const explicitRole = String(element.getAttribute('role') || '').toLowerCase();
    const inputType = tag === 'input' ? String(element.getAttribute('type') || 'text').toLowerCase() : '';
    if (tag === 'input' && inputType === 'hidden') return null;
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
        button: 'button', submit: 'button', reset: 'button', checkbox: 'checkbox',
        radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox'
      }[inputType] || 'textbox';
    }
    if (!role && element.isContentEditable) role = 'textbox';
    if (!role && Number.parseInt(element.getAttribute('tabindex'), 10) >= 0) role = 'generic';
    if (!role) return null;
    if (['button', 'link', 'searchbox', 'textbox'].includes(role)) priority += 20;
    if (element === element.ownerDocument.activeElement) priority += 30;
    if (element.closest('[role="dialog"], dialog[open], [aria-modal="true"]')) priority += 20;
    return { role, targetType: inputType || tag, priority };
  }

  function readAccessibleName(element) {
    const labelledBy = String(element.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => element.getRootNode().getElementById?.(id)?.textContent || '')
      .join(' ');
    const labelText = Array.from(element.labels || []).map((label) => label.textContent || '').join(' ');
    const acceptsUserText = element.isContentEditable ||
      ['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(
        String(element.getAttribute('role') || '').toLowerCase()
      ) || ['input', 'textarea', 'select'].includes(element.tagName.toLowerCase());
    return normalizeText(
      element.getAttribute('aria-label') || labelledBy || labelText ||
      element.getAttribute('title') || element.getAttribute('placeholder') ||
      (acceptsUserText ? '' : element.innerText) || ''
    ).slice(0, 240);
  }

  function isVisibleThroughFrameAncestors(globalRect, context) {
    const globalX = globalRect.x + globalRect.width / 2;
    const globalY = globalRect.y + globalRect.height / 2;
    return context.frameAncestors.every(({ element, parentContext }) => {
      const localX = (globalX - parentContext.offsetX) / parentContext.scaleX;
      const localY = (globalY - parentContext.offsetY) / parentContext.scaleY;
      const root = element.getRootNode();
      const hit = typeof root.elementFromPoint === 'function'
        ? root.elementFromPoint(localX, localY)
        : element.ownerDocument.elementFromPoint(localX, localY);
      return Boolean(hit && (hit === element || element.contains(hit)));
    });
  }

  function isVisibleAndActionable(element, localRect, globalRect, context) {
    if (
      element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' ||
      element.getAttribute('aria-hidden') === 'true' || element.closest('[inert]')
    ) return false;
    const view = element.ownerDocument.defaultView || globalThis;
    const style = view.getComputedStyle(element);
    if (
      localRect.width <= 2 || localRect.height <= 2 || !rectsIntersect(globalRect, context.clip) ||
      style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0 ||
      style.pointerEvents === 'none'
    ) return false;
    const x = Math.min(view.innerWidth - 1, Math.max(0, localRect.left + localRect.width / 2));
    const y = Math.min(view.innerHeight - 1, Math.max(0, localRect.top + localRect.height / 2));
    const root = element.getRootNode();
    const hit = typeof root.elementFromPoint === 'function'
      ? root.elementFromPoint(x, y)
      : element.ownerDocument.elementFromPoint(x, y);
    return Boolean(
      hit && (hit === element || element.contains(hit)) &&
      isVisibleThroughFrameAncestors(globalRect, context)
    );
  }

  function isVisibleSurface(element, context) {
    const localRect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return Boolean(
      localRect.width > 2 && localRect.height > 2 &&
      rectsIntersect(toGlobalRect(localRect, context), context.clip) &&
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    );
  }

  function isVisibleSemanticText(element, context) {
    if (element.isContentEditable || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return Boolean(
      rect.width > 0 && rect.height > 0 && rectsIntersect(toGlobalRect(rect, context), context.clip) &&
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    );
  }

  function readSemanticContext(element, context) {
    const container = element.closest('article, li, tr, [role="row"], [role="dialog"], dialog');
    if (!container || container === element || container.isContentEditable) return '';
    const heading = container.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    return normalizeText(
      container.getAttribute('aria-label') ||
      (heading && isVisibleSemanticText(heading, context) ? heading.innerText : '') || ''
    ).slice(0, 160);
  }

  function fingerprintElement(element, semantics, context) {
    const formDestination = readEffectiveFormDestination(element);
    const path = [];
    let node = element;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const parent = node.parentElement;
      const siblingIndex = parent ? Array.from(parent.children).indexOf(node) : 0;
      const stableName = node.id || node.getAttribute?.('data-testid') ||
        node.getAttribute?.('data-id') || node.getAttribute?.('name') || '';
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
      context.framePath.join('>'), context.shadowPath.join('>'), path.join('>'),
      semantics.role, semantics.targetType, readAccessibleName(element),
      element.getAttribute('href') || '', formDestination.action, formDestination.method
    ].join('|'));
  }

  function inspectElement(element, context, filters) {
    const semantics = readSemantics(element);
    if (
      !semantics || (filters.requestedRole && semantics.role !== filters.requestedRole) ||
      (filters.activeModal && !composedContains(filters.activeModal, element))
    ) return null;
    const localRect = element.getBoundingClientRect();
    const rect = toGlobalRect(localRect, context);
    if (
      !isVisibleAndActionable(element, localRect, rect, context) ||
      (filters.requestedRegion && !rectsIntersect(rect, filters.requestedRegion))
    ) return null;
    const formDestination = readEffectiveFormDestination(element);
    return {
      role: semantics.role,
      name: readAccessibleName(element),
      context: readSemanticContext(element, context),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height)
      },
      fingerprint: fingerprintElement(element, semantics, context),
      targetType: semantics.targetType,
      targetRole: semantics.role,
      targetHref: element.tagName.toLowerCase() === 'a' ? element.href : '',
      targetFormAction: formDestination.action,
      targetFormMethod: formDestination.method,
      framePath: [...context.framePath],
      shadowPath: [...context.shadowPath],
      node: element,
      priority: semantics.priority
    };
  }

  function deduplicateCandidates(items) {
    const seen = new Set();
    return items.filter((item) => {
      const hasMoreSpecificNestedTarget = items.some((candidate) =>
        candidate !== item && composedContains(item.node, candidate.node) &&
        (!item.name || item.name === candidate.name)
      );
      if (hasMoreSpecificNestedTarget) return false;
      const keyValue = [
        item.fingerprint, item.name, item.rect.x, item.rect.y, item.rect.width, item.rect.height
      ].join('|');
      if (seen.has(keyValue)) return false;
      seen.add(keyValue);
      return true;
    });
  }

  const helpers = Object.freeze({
    buildInitialContext,
    clampInteger,
    createFrameContext,
    deduplicateCandidates,
    findActiveModal,
    hash,
    inspectElement,
    isVisibleSurface,
    normalizeRegion,
    normalizeText,
    readEffectiveFormDestination
  });
  if (persist) globalThis[key] = helpers;
  return helpers;
}
