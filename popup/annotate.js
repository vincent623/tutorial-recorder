(function () {
  const TOOLS = [
    { id: 'arrow', label: '箭头' },
    { id: 'rect', label: '方框' },
    { id: 'mosaic', label: '马赛克' },
    { id: 'text', label: '文字' },
    { id: 'undo', label: '撤销' }
  ];
  const COLORS = ['#f5222d', '#faad14', '#1677ff', '#ffffff'];
  const WIDTHS = [2, 4, 6];
  const MOSAIC_BLOCK = 16;

  let session = null;

  function openAnnotateEditor({ dataUrl, onSave, onClose }) {
    if (session) {
      closeAnnotateEditor();
    }

    const image = new Image();
    image.onload = () => {
      session = createSession(image, dataUrl, onSave, onClose);
      session.mount();
    };
    image.onerror = () => {
      (onClose || function () {})(new Error('无法加载截图'));
    };
    image.src = dataUrl;
  }

  function closeAnnotateEditor() {
    if (!session) {
      return;
    }

    session.destroy();
    session = null;
  }

  function createSession(image, dataUrl, onSave, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'tr-annotate-overlay';
    overlay.innerHTML = [
      '<div class="tr-annotate-panel" role="dialog" aria-label="截图标注编辑器">',
      '  <div class="tr-annotate-toolbar">',
      '    <div class="tr-annotate-tools"></div>',
      '    <div class="tr-annotate-colors"></div>',
      '    <div class="tr-annotate-widths"></div>',
      '    <span class="tr-annotate-hint">箭头/方框/马赛克：拖拽绘制；文字：点击输入</span>',
      '    <div class="tr-annotate-actions">',
      '      <button type="button" class="tr-annotate-btn tr-annotate-cancel">取消</button>',
      '      <button type="button" class="tr-annotate-btn tr-annotate-save">保存标注</button>',
      '    </div>',
      '  </div>',
      '  <div class="tr-annotate-canvas-wrap"><canvas class="tr-annotate-canvas"></canvas></div>',
      '</div>'
    ].join('');

    const canvas = overlay.querySelector('.tr-annotate-canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');

    const state = {
      tool: 'arrow',
      color: COLORS[0],
      width: WIDTHS[1],
      shapes: [],
      draft: null,
      drawing: false,
      destroyed: false,
      textInput: null
    };

    function mount() {
      injectStyles();
      buildToolbar();
      document.body.appendChild(overlay);
      overlay.addEventListener('mousedown', handleMouseDown);
      overlay.addEventListener('mousemove', handleMouseMove);
      overlay.addEventListener('mouseup', handleMouseUp);
      overlay.querySelector('.tr-annotate-cancel').addEventListener('click', cancel);
      overlay.querySelector('.tr-annotate-save').addEventListener('click', save);
      document.addEventListener('keydown', handleKeyDown, true);
      render();
      overlay.querySelector('[data-tool="arrow"]').focus();
    }

    function destroy() {
      state.destroyed = true;
      document.removeEventListener('keydown', handleKeyDown, true);
      overlay.remove();
      removeStyles();
    }

    function injectStyles() {
      if (document.getElementById('tr-annotate-style')) {
        return;
      }

      const style = document.createElement('style');
      style.id = 'tr-annotate-style';
      style.textContent = [
        '.tr-annotate-overlay { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15, 23, 42, 0.72); display: flex; align-items: center; justify-content: center; padding: 24px; }',
        '.tr-annotate-panel { display: flex; flex-direction: column; gap: 12px; max-width: min(1200px, 96vw); max-height: 92vh; background: #0f172a; border-radius: 16px; padding: 14px 16px 18px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45); }',
        '.tr-annotate-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }',
        '.tr-annotate-tools, .tr-annotate-colors, .tr-annotate-widths { display: flex; gap: 6px; }',
        '.tr-annotate-btn { appearance: none; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; border-radius: 8px; font: 500 13px/1 inherit; padding: 8px 12px; cursor: pointer; }',
        '.tr-annotate-btn:hover { background: #334155; }',
        '.tr-annotate-btn.is-active { border-color: #1677ff; color: #ffffff; background: #0f5ecb; }',
        '.tr-annotate-save { background: #1677ff; border-color: #1677ff; color: #ffffff; }',
        '.tr-annotate-save:hover { background: #0f5ecb; }',
        '.tr-annotate-swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }',
        '.tr-annotate-swatch.is-active { border-color: #ffffff; }',
        '.tr-annotate-width { min-width: 30px; }',
        '.tr-annotate-hint { color: #94a3b8; font-size: 12px; flex: 1; min-width: 160px; }',
        '.tr-annotate-actions { display: flex; gap: 8px; }',
        '.tr-annotate-canvas-wrap { overflow: auto; border-radius: 12px; background: #1e293b; }',
      '.tr-annotate-canvas { display: block; max-width: 100%; cursor: crosshair; }',
        '.tr-annotate-text-input { position: absolute; z-index: 2147483100; font: 600 16px/1.2 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 4px 8px; border: 2px solid #1677ff; border-radius: 6px; outline: none; min-width: 120px; background: #ffffff; color: #0f172a; }'
      ].join('\n');
      document.head.appendChild(style);
    }

    function removeStyles() {}

    function buildToolbar() {
      const toolsBox = overlay.querySelector('.tr-annotate-tools');
      toolsBox.innerHTML = '';
      for (const tool of TOOLS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tr-annotate-btn';
        button.dataset.tool = tool.id;
        button.textContent = tool.label;
        if (tool.id === state.tool) {
          button.classList.add('is-active');
        }
        button.addEventListener('click', () => selectTool(tool.id));
        toolsBox.appendChild(button);
      }

      const colorsBox = overlay.querySelector('.tr-annotate-colors');
      colorsBox.innerHTML = '';
      for (const color of COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'tr-annotate-swatch' + (color === state.color ? ' is-active' : '');
        swatch.style.background = color;
        swatch.title = color;
        swatch.addEventListener('click', () => {
          state.color = color;
          colorsBox.querySelectorAll('.tr-annotate-swatch').forEach((item) => item.classList.remove('is-active'));
          swatch.classList.add('is-active');
        });
        colorsBox.appendChild(swatch);
      }

      const widthsBox = overlay.querySelector('.tr-annotate-widths');
      widthsBox.innerHTML = '';
      for (const width of WIDTHS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tr-annotate-btn tr-annotate-width';
        button.textContent = `${width}px`;
        if (width === state.width) {
          button.classList.add('is-active');
        }
        button.addEventListener('click', () => {
          state.width = width;
          widthsBox.querySelectorAll('.tr-annotate-width').forEach((item) => item.classList.remove('is-active'));
          button.classList.add('is-active');
        });
        widthsBox.appendChild(button);
      }
    }

    function selectTool(toolId) {
      if (toolId === 'undo') {
        state.shapes.pop();
        render();
        return;
      }

      state.tool = toolId;
      overlay.querySelectorAll('.tr-annotate-tools .tr-annotate-btn').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.tool === toolId);
      });
    }

    function canvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height
      };
    }

    function handleMouseDown(event) {
      if (event.target !== canvas || state.destroyed) {
        return;
      }

      if (state.tool === 'text') {
        placeTextInput(event);
        return;
      }

      event.preventDefault();
      const point = canvasPoint(event);
      state.drawing = true;
      state.draft = {
        type: state.tool,
        color: state.color,
        width: state.width,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y
      };
    }

    function handleMouseMove(event) {
      if (!state.drawing || state.destroyed) {
        return;
      }

      const point = canvasPoint(event);
      state.draft.x2 = point.x;
      state.draft.y2 = point.y;
      render();
    }

    function handleMouseUp() {
      if (!state.drawing) {
        return;
      }

      const shape = state.draft;
      state.drawing = false;
      state.draft = null;

      const size = Math.max(Math.abs(shape.x2 - shape.x1), Math.abs(shape.y2 - shape.y1));
      if (size >= 6) {
        state.shapes.push(shape);
      }

      render();
    }

    function placeTextInput(event) {
      commitTextInput();
      const point = canvasPoint(event);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tr-annotate-text-input';
      input.placeholder = '输入文字，回车确认';
      const canvasRect = canvas.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      input.style.left = `${canvasRect.left - overlayRect.left + (point.x / canvas.width) * canvasRect.width + 8}px`;
      input.style.top = `${canvasRect.top - overlayRect.top + (point.y / canvas.height) * canvasRect.height - 14}px`;
      overlay.appendChild(input);
      state.textInput = { element: input, point };
      setTimeout(() => input.focus(), 0);
    }

    function commitTextInput() {
      const entry = state.textInput;
      if (!entry) {
        return;
      }

      state.textInput = null;
      const text = entry.element.value.trim();
      entry.element.remove();
      if (text) {
        state.shapes.push({
          type: 'text',
          color: state.color,
          width: state.width,
          text: text.slice(0, 120),
          x1: entry.point.x,
          y1: entry.point.y
        });
        render();
      }
    }

    function handleKeyDown(event) {
      if (state.destroyed) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (state.textInput) {
          commitTextInput();
          return;
        }
        cancel();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        state.shapes.pop();
        render();
      }

      if (event.key === 'Enter' && state.textInput) {
        commitTextInput();
      }
    }

    function render() {
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const scratchCtx = scratch.getContext('2d');
      scratchCtx.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const shape of state.shapes) {
        if (shape.type === 'mosaic') {
          pixelateRegion(scratchCtx, shape);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(scratch, 0, 0);

      for (const shape of state.shapes) {
        if (shape.type !== 'mosaic') {
          drawShape(ctx, shape);
        }
      }

      if (state.draft && state.draft.type !== 'mosaic') {
        drawShape(ctx, state.draft);
      } else if (state.draft && state.draft.type === 'mosaic') {
        ctx.save();
        ctx.strokeStyle = '#1677ff';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.min(state.draft.x1, state.draft.x2),
          Math.min(state.draft.y1, state.draft.y2),
          Math.abs(state.draft.x2 - state.draft.x1),
          Math.abs(state.draft.y2 - state.draft.y1)
        );
        ctx.restore();
      }
    }

    function pixelateRegion(targetCtx, shape) {
      const x = Math.max(0, Math.round(Math.min(shape.x1, shape.x2)));
      const y = Math.max(0, Math.round(Math.min(shape.y1, shape.y2)));
      const w = Math.min(targetCtx.canvas.width - x, Math.round(Math.abs(shape.x2 - shape.x1)));
      const h = Math.min(targetCtx.canvas.height - y, Math.round(Math.abs(shape.y2 - shape.y1)));
      if (w < 2 || h < 2) {
        return;
      }

      const tiny = document.createElement('canvas');
      tiny.width = Math.max(1, Math.round(w / MOSAIC_BLOCK));
      tiny.height = Math.max(1, Math.round(h / MOSAIC_BLOCK));
      const tinyCtx = tiny.getContext('2d');
      tinyCtx.drawImage(targetCtx.canvas, x, y, w, h, 0, 0, tiny.width, tiny.height);

      targetCtx.imageSmoothingEnabled = false;
      targetCtx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
      targetCtx.imageSmoothingEnabled = true;
    }

    function drawShape(targetCtx, shape) {
      targetCtx.save();

      if (shape.type === 'arrow') {
        const dx = shape.x2 - shape.x1;
        const dy = shape.y2 - shape.y1;
        const length = Math.hypot(dx, dy) || 1;
        const headSize = Math.max(12, shape.width * 4);
        const angle = Math.atan2(dy, dx);

        targetCtx.strokeStyle = shape.color;
        targetCtx.lineWidth = shape.width;
        targetCtx.lineCap = 'round';
        targetCtx.beginPath();
        targetCtx.moveTo(shape.x1, shape.y1);
        targetCtx.lineTo(shape.x2 - Math.cos(angle) * headSize * 0.6, shape.y2 - Math.sin(angle) * headSize * 0.6);
        targetCtx.stroke();

        targetCtx.fillStyle = shape.color;
        targetCtx.beginPath();
        targetCtx.moveTo(shape.x2, shape.y2);
        targetCtx.lineTo(
          shape.x2 - Math.cos(angle - Math.PI / 7) * headSize,
          shape.y2 - Math.sin(angle - Math.PI / 7) * headSize
        );
        targetCtx.lineTo(
          shape.x2 - Math.cos(angle + Math.PI / 7) * headSize,
          shape.y2 - Math.sin(angle + Math.PI / 7) * headSize
        );
        targetCtx.closePath();
        targetCtx.fill();
      } else if (shape.type === 'rect') {
        targetCtx.strokeStyle = shape.color;
        targetCtx.lineWidth = shape.width;
        targetCtx.strokeRect(
          Math.min(shape.x1, shape.x2),
          Math.min(shape.y1, shape.y2),
          Math.abs(shape.x2 - shape.x1),
          Math.abs(shape.y2 - shape.y1)
        );
      } else if (shape.type === 'text') {
        const fontSize = Math.max(18, shape.width * 8);
        targetCtx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
        targetCtx.textBaseline = 'middle';
        targetCtx.lineWidth = Math.max(3, fontSize / 7);
        targetCtx.strokeStyle = '#0f172a';
        targetCtx.strokeText(shape.text, shape.x1, shape.y1);
        targetCtx.fillStyle = shape.color;
        targetCtx.fillText(shape.text, shape.x1, shape.y1);
      }

      targetCtx.restore();
    }

    function cancel() {
      closeAnnotateEditor();
      if (onClose) {
        onClose();
      }
    }

    function save() {
      commitTextInput();
      if (!state.shapes.length) {
        cancel();
        return;
      }

      const annotatedDataUrl = canvas.toDataURL('image/png');
      closeAnnotateEditor();
      if (onSave) {
        onSave(annotatedDataUrl);
      }
    }

    return { mount, destroy };
  }

  window.TutorialAnnotate = {
    open: openAnnotateEditor,
    close: closeAnnotateEditor,
    isActive: () => Boolean(session)
  };
})();
