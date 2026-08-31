export function performObservedPageAction(action, expectedFingerprint, expectedDocumentToken, suppliedHelpers = null) {
  const helpersKey = '__tutorialRecorderBrowserObservationProbeHelpersV1';
  const helpers = suppliedHelpers || globalThis[helpersKey];
  if (!suppliedHelpers) delete globalThis[helpersKey];
  if (!helpers) return { ok: false, reasonCode: 'observation-verification-failed' };

  const initialContext = helpers.buildInitialContext();
  const topView = initialContext.topDocument?.defaultView || globalThis;
  const sourceUrl = String(topView.location.href || '');
  const documentToken = helpers.hash(`${topView.performance.timeOrigin}|${sourceUrl}`);
  if (expectedDocumentToken && documentToken !== expectedDocumentToken) {
    return { ok: false, reasonCode: 'observation-page-changed' };
  }

  const roots = [initialContext];
  const observedRegions = {};
  const observedDocumentTokens = [];
  const pageModal = helpers.findActiveModal(initialContext.topDocument || document, true);
  while (roots.length) {
    const context = roots.shift();
    const walker = (context.root.ownerDocument || context.root).createTreeWalker(context.root, 1);
    let element = walker.nextNode();
    while (element) {
      if (element.shadowRoot?.mode === 'open') {
        roots.push({
          ...context,
          root: element.shadowRoot,
          shadowPath: [...context.shadowPath, describeShadowHost(element, helpers)]
        });
      }
      if (element.matches('iframe, frame')) {
        const frameContext = helpers.createFrameContext(
          element,
          context,
          observedRegions,
          observedDocumentTokens
        );
        if (frameContext) roots.push(frameContext);
      }
      const observed = helpers.inspectElement(element, context, {
        requestedRole: '',
        requestedRegion: null,
        activeModal: pageModal
      });
      if (observed?.fingerprint === expectedFingerprint) {
        const result = dispatchToElement(element, action, helpers);
        const { node, priority, ...target } = observed;
        return {
          ...result,
          target,
          documentToken,
          url: sourceUrl,
          resultUrl: String(topView.location.href || '')
        };
      }
      element = walker.nextNode();
    }
  }
  return { ok: false, reasonCode: 'observation-target-changed' };

  function describeShadowHost(element, availableHelpers) {
    return [
      element.tagName.toLowerCase(),
      availableHelpers.normalizeText(element.id).slice(0, 80),
      availableHelpers.normalizeText(element.getAttribute('name')).slice(0, 80),
      availableHelpers.normalizeText(element.getAttribute('aria-label')).slice(0, 80)
    ].join(':');
  }

  function dispatchToElement(element, requestedAction, availableHelpers) {
    if (requestedAction.action === 'click_at_xy') {
      element.focus?.({ preventScroll: true });
      element.click();
      return { ok: true };
    }
    if (requestedAction.action === 'hover') {
      for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: type !== 'mouseenter',
          cancelable: true,
          composed: true
        }));
      }
      return { ok: true };
    }
    if (requestedAction.action !== 'type_text') {
      return { ok: false, reasonCode: 'unsupported-observation-action' };
    }
    const editable = isSupportedEditable(element) ? element : null;
    if (!editable) return { ok: false, reasonCode: 'unsupported-observation-action' };
    let submitDestination = null;
    if (requestedAction.submit === true) {
      submitDestination = availableHelpers.readEffectiveFormDestination(editable);
      const approvedUnsafeSubmit = Boolean(
        requestedAction.approvalAuthorization &&
        requestedAction.approvalSourceUrl === String(topView.location.href || '')
      );
      if (!editable.form || (submitDestination.method !== 'get' && !approvedUnsafeSubmit)) {
        return { ok: false, reasonCode: 'unsafe-form' };
      }
    }
    editable.focus({ preventScroll: true });
    const editableTag = String(editable.tagName || '').toLowerCase();
    const ownerView = editable.ownerDocument?.defaultView || topView;
    const text = String(requestedAction.text || '');
    if (editableTag === 'input' || editableTag === 'textarea') {
      const prototype = editableTag === 'input'
        ? ownerView.HTMLInputElement?.prototype
        : ownerView.HTMLTextAreaElement?.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!nativeSetter) return { ok: false, reasonCode: 'unsupported-observation-action' };
      try {
        nativeSetter.call(editable, text);
      } catch (error) {
        return { ok: false, reasonCode: 'unsupported-observation-action' };
      }
    } else {
      editable.textContent = text;
    }
    editable.dispatchEvent(new ownerView.InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text
    }));
    editable.dispatchEvent(new ownerView.Event('change', { bubbles: true, composed: true }));
    if (requestedAction.submit === true) {
      editable.form.requestSubmit();
    }
    return { ok: true };
  }

  function isSupportedEditable(element) {
    if (element.matches?.('textarea, [contenteditable="true"]')) return true;
    if (!element.matches?.('input')) return false;
    const type = String(element.getAttribute('type') || 'text').toLowerCase();
    return [
      'text', 'search', 'email', 'url', 'tel', 'password', 'number',
      'date', 'datetime-local', 'month', 'week', 'time'
    ].includes(type);
  }
}
