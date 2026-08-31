export function inspectVisibleInteractivePage(options = {}, suppliedHelpers = null) {
  const helpersKey = '__tutorialRecorderBrowserObservationProbeHelpersV1';
  const helpers = suppliedHelpers || globalThis[helpersKey];
  if (!suppliedHelpers) delete globalThis[helpersKey];
  if (!helpers) throw new Error('Browser Observation probe helpers unavailable');

  const maxElements = helpers.clampInteger(options.maxElements, 1, 250, 80);
  const maxNodes = helpers.clampInteger(options.maxNodes, maxElements, 20_000, 5_000);
  const requestedRole = helpers.normalizeText(options.role).toLowerCase();
  const requestedRegion = helpers.normalizeRegion(options.region);
  const traverseSameOriginFrames = options.traverseSameOriginFrames !== false;
  const initialContext = helpers.buildInitialContext();
  const pageModal = helpers.findActiveModal(initialContext.topDocument || document, true);
  const candidates = [];
  const observedDocumentTokens = [];
  const roots = [initialContext];
  const observedRegions = {
    openShadowDom: 0,
    sameOriginFrames: 0,
    crossOriginFrames: 0,
    inaccessibleFrames: 0,
    transformedFrames: 0,
    selfDrawnSurfaces: 0
  };
  let inspectedNodeCount = 0;
  let nodeLimitReached = false;

  while (roots.length && !nodeLimitReached) {
    const context = roots.shift();
    const root = context.root;
    const activeModal = pageModal || helpers.findActiveModal(root, false);
    const walker = (root.ownerDocument || root).createTreeWalker(root, 1);
    let element = walker.nextNode();
    while (element) {
      inspectedNodeCount += 1;
      if (inspectedNodeCount >= maxNodes) {
        nodeLimitReached = true;
        break;
      }
      if (element.shadowRoot?.mode === 'open') {
        observedRegions.openShadowDom += 1;
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
        if (frameContext && traverseSameOriginFrames) roots.push(frameContext);
      }
      if (element.matches('canvas') && helpers.isVisibleSurface(element, context)) {
        observedRegions.selfDrawnSurfaces += 1;
      }
      const observed = helpers.inspectElement(element, context, {
        requestedRole,
        requestedRegion,
        activeModal
      });
      if (observed) candidates.push(observed);
      element = walker.nextNode();
    }
  }

  const unique = helpers.deduplicateCandidates(candidates);
  const elements = unique
    .sort((left, right) =>
      right.priority - left.priority || left.rect.y - right.rect.y || left.rect.x - right.rect.x
    )
    .slice(0, maxElements)
    .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
    .map(({ node, ...element }) => element);
  const truncated = nodeLimitReached || unique.length > maxElements;
  const documentToken = helpers.hash(`${performance.timeOrigin}|${location.href}`);
  const documentTokens = [documentToken, ...observedDocumentTokens].sort();
  const topView = initialContext.topDocument?.defaultView || globalThis;
  const viewport = {
    width: finiteNumber(topView.innerWidth, innerWidth),
    height: finiteNumber(topView.innerHeight, innerHeight),
    scrollX: finiteNumber(topView.scrollX, 0),
    scrollY: finiteNumber(topView.scrollY, 0),
    devicePixelRatio: finiteNumber(topView.devicePixelRatio, 1),
    pageScaleFactor: finiteNumber(topView.visualViewport?.scale, 1),
    visualOffsetX: finiteNumber(topView.visualViewport?.offsetLeft, 0),
    visualOffsetY: finiteNumber(topView.visualViewport?.offsetTop, 0)
  };
  const frameContext = {
    isTop: initialContext.framePath.length === 0,
    sameOriginToTop: initialContext.sameOriginToTop,
    framePath: [...initialContext.framePath]
  };
  const revision = helpers.hash(JSON.stringify({
    documentToken,
    documentTokens,
    frameContext,
    url: location.href,
    title: document.title,
    viewport,
    observedRegions,
    truncated,
    elements
  }));
  return {
    documentToken,
    documentTokens,
    frameContext,
    revision,
    url: location.href,
    title: document.title,
    viewport,
    observedRegions,
    elements,
    truncated,
    inspectedNodeCount,
    degradedReasons: nodeLimitReached ? ['node-scan-limit-reached'] : []
  };

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function describeShadowHost(element, availableHelpers) {
    return [
      element.tagName.toLowerCase(),
      element.id,
      element.getAttribute('name'),
      element.getAttribute('title')
    ].map((value) => availableHelpers.normalizeText(value).slice(0, 80)).join(':');
  }
}
