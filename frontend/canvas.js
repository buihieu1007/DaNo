/* ═══════════════════════════════════════════════════════════════════════════
   canvas.js — Canvas rendering, zoom/pan, annotation drawing tools
   ═══════════════════════════════════════════════════════════════════════════ */

class AnnotationCanvas {
  constructor() {
    // Canvases
    this.imageCanvas = document.getElementById('imageCanvas');
    this.annoCanvas  = document.getElementById('annotationCanvas');
    this.interCanvas = document.getElementById('interactionCanvas');
    this.container   = document.getElementById('canvasContainer');

    this.imageCtx = this.imageCanvas.getContext('2d');
    this.annoCtx  = this.annoCanvas.getContext('2d');
    this.interCtx = this.interCanvas.getContext('2d');

    // State
    this.image = null;
    this.imageW = 0;
    this.imageH = 0;

    // Annotation mask — uint8 array, 0 = no label, 1..N = class ID
    this.mask = null;

    // Undo stack
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 30;

    // View transform
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    // Tool state
    this.tool = 'polygon';       // polygon | brush | eraser
    this.activeClassId = 0;
    this.brushSize = 15;
    this.subtractMode = false;
    this.overlayOpacity = 0.45;
    this.showOverlay = true;

    // Polygon state
    this.polyNodes = [];
    this.polyActive = false;

    // Painting
    this.isPainting = false;
    this.lastPaintPos = null;

    // Brush Resizing (Ctrl + Drag)
    this.isResizingBrush = false;
    this.resizeStart = { x: 0, y: 0, size: 0 };

    // Panning
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Classes (will be set from app)
    this.classes = [];

    // Bind events
    this._bindEvents();
  }

  /* ── Setup ────────────────────────────────────────────────────────────── */

  setClasses(classes) {
    this.classes = classes;
  }

  setActiveClass(id) {
    this.activeClassId = id;
  }

  setTool(tool) {
    this.tool = tool;
    // Cancel any in-progress polygon
    if (tool !== 'polygon' && this.polyActive) {
      this.polyNodes = [];
      this.polyActive = false;
      this.renderInteraction();
    }
    this._updateCursor();
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  setSubtractMode(on) {
    this.subtractMode = on;
  }

  setOverlayOpacity(val) {
    this.overlayOpacity = val;
    this.renderAnnotation();
  }

  setShowOverlay(on) {
    this.showOverlay = on;
    this.renderAnnotation();
  }

  /* ── Load Image ───────────────────────────────────────────────────────── */

  loadImage(url, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.imageW = width;
        this.imageH = height;
        this.mask = new Uint8Array(width * height);
        this.undoStack = [];
        this.redoStack = [];
        this.polyNodes = [];
        this.polyActive = false;
        this._resizeCanvases();
        this.fitView();
        this.renderAll();
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* ── Load Existing Annotation ─────────────────────────────────────────── */

  loadMask(data, shape, dtype) {
    let arr;
    if (typeof data === 'string') {
      const raw = atob(data);
      arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    } else {
      arr = data;
    }
    
    if (arr.length === this.imageW * this.imageH) {
      this.mask = arr;
    } else {
      console.warn('Annotation size mismatch, creating new mask');
      this.mask = new Uint8Array(this.imageW * this.imageH);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.renderAnnotation();
  }

  getMask() {
    return this.mask;
  }

  /* ── Canvas Sizing ────────────────────────────────────────────────────── */

  _resizeCanvases() {
    const rect = this.container.getBoundingClientRect();
    const dpr = 1; // use 1:1 for annotation accuracy
    [this.imageCanvas, this.annoCanvas, this.interCanvas].forEach(c => {
      c.width  = rect.width * dpr;
      c.height = rect.height * dpr;
      c.style.width  = rect.width + 'px';
      c.style.height = rect.height + 'px';
    });
  }

  handleResize() {
    this._resizeCanvases();
    this.renderAll();
  }

  /* ── View Controls ────────────────────────────────────────────────────── */

  fitView() {
    if (!this.image) return;
    const rect = this.container.getBoundingClientRect();
    const scaleX = rect.width / this.imageW;
    const scaleY = rect.height / this.imageH;
    this.minZoom = Math.min(scaleX, scaleY) * 0.92;
    this.zoom = this.minZoom;
    this.panX = (rect.width  - this.imageW * this.zoom) / 2;
    this.panY = (rect.height - this.imageH * this.zoom) / 2;
    this._updateZoomDisplay();
    this.renderAll();
  }

  zoomIn()  { this._zoomBy(1.25); }
  zoomOut() { this._zoomBy(0.8); }

  _zoomBy(factor) {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    this._zoomAt(cx, cy, factor);
  }

  _zoomAt(cx, cy, factor) {
    const minZoomLimit = this.minZoom || 0.05;
    const targetZoom = this.zoom * factor;

    // Center and snap perfectly to fit-view bounds if zooming out too far
    if (targetZoom <= minZoomLimit) {
      this.fitView();
      return;
    }

    const oldZoom = this.zoom;
    this.zoom = Math.min(50, targetZoom);
    const ratio = this.zoom / oldZoom;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this._updateZoomDisplay();
    this.renderAll();
  }

  _updateZoomDisplay() {
    const el = document.getElementById('statusZoom');
    if (el) el.textContent = Math.round(this.zoom * 100) + '%';
  }

  /* ── Coordinate Transforms ────────────────────────────────────────────── */

  screenToImage(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  imageToScreen(ix, iy) {
    return {
      x: ix * this.zoom + this.panX,
      y: iy * this.zoom + this.panY,
    };
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */

  renderAll() {
    this.renderImage();
    this.renderAnnotation();
    this.renderInteraction();
  }

  renderImage() {
    const ctx = this.imageCtx;
    const c = this.imageCanvas;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.image) return;

    // Checkerboard background
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, this.imageW, this.imageH);
    ctx.drawImage(this.image, 0, 0, this.imageW, this.imageH);
    ctx.restore();
  }

  renderAnnotation() {
    const ctx = this.annoCtx;
    const c = this.annoCanvas;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.mask || !this.showOverlay) return;

    // Pre-build a color lookup table indexed by classId (avoids .find() and regex per pixel)
    const maxClassId = this.classes.reduce((m, cl) => Math.max(m, cl.id), 0);
    const lutR = new Uint8Array(maxClassId + 1);
    const lutG = new Uint8Array(maxClassId + 1);
    const lutB = new Uint8Array(maxClassId + 1);
    const lutValid = new Uint8Array(maxClassId + 1);
    for (let j = 0; j < this.classes.length; j++) {
      const cl = this.classes[j];
      const rgb = this._hexToRgb(cl.color);
      lutR[cl.id] = rgb.r;
      lutG[cl.id] = rgb.g;
      lutB[cl.id] = rgb.b;
      lutValid[cl.id] = 1;
    }

    const imgData = ctx.createImageData(this.imageW, this.imageH);
    const data = imgData.data;
    const alpha = Math.round(this.overlayOpacity * 255);
    const mask = this.mask;
    const len = mask.length;

    for (let i = 0; i < len; i++) {
      const cid = mask[i];
      if (cid === 0 || cid > maxClassId || !lutValid[cid]) continue;
      const idx = i << 2; // i * 4 via bitshift
      data[idx]     = lutR[cid];
      data[idx + 1] = lutG[cid];
      data[idx + 2] = lutB[cid];
      data[idx + 3] = alpha;
    }

    // Reuse cached offscreen canvas instead of creating a new DOM element every frame
    if (!this._annoOffscreen || this._annoOffscreen.width !== this.imageW || this._annoOffscreen.height !== this.imageH) {
      this._annoOffscreen = document.createElement('canvas');
      this._annoOffscreen.width = this.imageW;
      this._annoOffscreen.height = this.imageH;
    }
    this._annoOffscreen.getContext('2d').putImageData(imgData, 0, 0);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._annoOffscreen, 0, 0);
    ctx.restore();
  }

  renderInteraction() {
    const ctx = this.interCtx;
    const c = this.interCanvas;
    ctx.clearRect(0, 0, c.width, c.height);

    // Draw in-progress polygon
    if (this.polyNodes.length > 0) {
      let strokeColor = '#00BCD4'; // default
      let fillColor = 'rgba(0, 188, 212, 0.15)';
      
      const cls = this.classes.find(c => c.id === this.activeClassId);
      if (cls && cls.color) {
        strokeColor = cls.color;
        
        // Convert hex to rgba for fill
        const rgb = this._hexToRgb(cls.color);
        fillColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`;
      }

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.fillStyle = fillColor;

      ctx.beginPath();
      const first = this.imageToScreen(this.polyNodes[0].x, this.polyNodes[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.polyNodes.length; i++) {
        const p = this.imageToScreen(this.polyNodes[i].x, this.polyNodes[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      ctx.restore();
    }
  }

  /* ── Event Handling ───────────────────────────────────────────────────── */

  _bindEvents() {
    const c = this.interCanvas;

    c.addEventListener('mousedown', (e) => this._onMouseDown(e));
    c.addEventListener('mousemove', (e) => this._onMouseMove(e));
    c.addEventListener('mouseup',   (e) => this._onMouseUp(e));
    c.addEventListener('wheel',     (e) => this._onWheel(e), { passive: false });
    c.addEventListener('mouseleave', () => this._onMouseLeave());
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Control' && this.isResizingBrush) {
        this.isResizingBrush = false;
        this._updateCursor();
      }
    });
  }

  _getPos(e) {
    const rect = this.container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onMouseDown(e) {
    const pos = this._getPos(e);
    const imgPos = this.screenToImage(pos.x, pos.y);

    // Middle button or Space+click = pan
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.isPanning = true;
      this.panStart = { x: pos.x - this.panX, y: pos.y - this.panY };
      this.interCanvas.style.cursor = 'grabbing';
      return;
    }

    // Removed Ctrl+Left Click requirement

    // Right click = finish polygon
    if (e.button === 2) {
      if (this.polyActive) {
        this.closePolygon();
      }
      return;
    }

    if (!this.image || e.button !== 0) return;

    // Check bounds
    if (imgPos.x < 0 || imgPos.x >= this.imageW || imgPos.y < 0 || imgPos.y >= this.imageH) {
      return;
    }

    if (this.tool === 'polygon') {
      this._polygonClick(imgPos);
    } else if (this.tool === 'brush' || this.tool === 'eraser') {
      this._pushUndo();
      this.isPainting = true;
      this.lastPaintPos = imgPos;
      this._paintAt(imgPos);
    }
  }

  _onMouseMove(e) {
    const pos = this._getPos(e);
    const imgPos = this.screenToImage(pos.x, pos.y);

    // Update status coords
    const coordEl = document.getElementById('statusCoords');
    if (coordEl) {
      const ix = Math.floor(imgPos.x), iy = Math.floor(imgPos.y);
      coordEl.textContent = `X: ${ix}  Y: ${iy}`;
    }

    if (this.isPanning) {
      this.panX = pos.x - this.panStart.x;
      this.panY = pos.y - this.panStart.y;
      this.renderAll();
      return;
    }

    // Ctrl + Mouse Move = Resize Brush
    if (e.ctrlKey && (this.tool === 'brush' || this.tool === 'eraser')) {
      if (!this.isResizingBrush) {
        this.isResizingBrush = true;
        this.resizeStart = { x: pos.x, y: pos.y, size: this.brushSize };
        this.interCanvas.style.cursor = 'ew-resize';
      }

      // Calculate deltaX to change brush size (1-to-1 screen pixels)
      const deltaX = pos.x - this.resizeStart.x;
      let newSize = this.resizeStart.size + Math.round(deltaX); 
      newSize = Math.max(1, Math.min(300, newSize));
      
      if (newSize !== this.brushSize) {
        this.setBrushSize(newSize);
        if (window.app && window.app.toolbar && window.app.toolbar.syncBrushSize) {
          window.app.toolbar.syncBrushSize(newSize);
        }
      }
      this._drawBrushCursor(pos, imgPos);
      return;
    } else if (this.isResizingBrush) {
      // Stopped holding Ctrl
      this.isResizingBrush = false;
      this._updateCursor();
    }

    if (this.isPainting && (this.tool === 'brush' || this.tool === 'eraser')) {
      this._paintLine(this.lastPaintPos, imgPos);
      this.lastPaintPos = imgPos;
      
      // Batch the heavy renderAnnotation call using requestAnimationFrame
      if (!this._renderPending) {
        this._renderPending = true;
        requestAnimationFrame(() => {
          this.renderAnnotation();
          this._renderPending = false;
        });
      }
    }

    // Draw brush cursor on interaction canvas
    if (this.tool === 'brush' || this.tool === 'eraser') {
      this._drawBrushCursor(pos, imgPos);
    }
  }

  _onMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this._updateCursor();
      return;
    }
    if (this.isPainting) {
      this.isPainting = false;
      this.lastPaintPos = null;
      if (window.app && window.app.renderZonesList) {
        window.app.renderZonesList();
      }
    }
  }

  _onMouseLeave() {
    this.isPanning = false;
    this.isPainting = false;
    this.isResizingBrush = false;
    this.lastPaintPos = null;
    // Clear brush cursor
    if (this.tool === 'brush' || this.tool === 'eraser') {
      this.renderInteraction();
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const pos = this._getPos(e);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    this._zoomAt(pos.x, pos.y, factor);
  }

  _updateCursor() {
    // Always clear any inline cursor style (e.g. 'ew-resize' from Ctrl+Move)
    this.interCanvas.style.cursor = '';
    if (this.tool === 'brush' || this.tool === 'eraser') {
      this.container.className = this.tool + '-cursor';
    } else {
      this.container.className = '';
      this.interCanvas.style.cursor = 'crosshair';
    }
  }

  /* ── Brush Cursor ─────────────────────────────────────────────────────── */

  _drawBrushCursor(screenPos, imgPos) {
    const ctx = this.interCtx;
    this.renderInteraction(); // clear + re-draw polygon if any
    const r = this.brushSize; // Brush size is now in constant screen pixels
    ctx.save();
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = this.tool === 'eraser' ? '#EF5350' : '#00BCD4';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    // Center dot
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  }

  /* ── Polygon Tool ─────────────────────────────────────────────────────── */

  _polygonClick(imgPos) {
    if (!this.polyActive) {
      this.polyActive = true;
      this.polyNodes = [{ x: imgPos.x, y: imgPos.y }];
    } else {
      // Check if clicking near first node to close
      const first = this.polyNodes[0];
      const dist = Math.hypot(imgPos.x - first.x, imgPos.y - first.y);
      if (dist < 8 / this.zoom && this.polyNodes.length >= 3) {
        this.closePolygon();
        return;
      }
      this.polyNodes.push({ x: imgPos.x, y: imgPos.y });
    }
    this.renderInteraction();
  }

  addPolygonNode() {
    // Hotkey D: duplicate last position (user moves mouse)
    // This is a no-op hint — the click already adds
  }

  closePolygon() {
    if (this.polyNodes.length < 3) return;
    this._pushUndo();
    this._fillPolygon(this.polyNodes);
    this.polyNodes = [];
    this.polyActive = false;
    this.renderInteraction();
    this.renderAnnotation();
    if (window.app && window.app.renderZonesList) {
      window.app.renderZonesList();
    }
  }

  _fillPolygon(nodes) {
    // Rasterize polygon into the mask
    const classId = this.subtractMode ? 0 : this.activeClassId;
    if (classId === 0 && !this.subtractMode) return;

    // Use off-screen canvas to rasterize
    const offscreen = document.createElement('canvas');
    offscreen.width = this.imageW;
    offscreen.height = this.imageH;
    const ctx = offscreen.getContext('2d');

    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      ctx.lineTo(nodes[i].x, nodes[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();

    const imgData = ctx.getImageData(0, 0, this.imageW, this.imageH);
    const pixels = imgData.data;
    for (let i = 0; i < this.mask.length; i++) {
      if (pixels[i * 4 + 3] > 128) {
        this.mask[i] = classId;
      }
    }
  }

  /* ── Brush / Eraser Painting ──────────────────────────────────────────── */

  _paintAt(imgPos) {
    const classId = this.tool === 'eraser' || this.subtractMode ? 0 : this.activeClassId;
    if (classId === 0 && this.tool === 'brush' && !this.subtractMode) return;

    // Convert screen pixel brush radius into image space radius
    const r = Math.max(1, Math.round(this.brushSize / this.zoom));
    const cx = Math.round(imgPos.x);
    const cy = Math.round(imgPos.y);

    // High performance brush: Pre-calculate the circle offsets and cache them
    if (!this._brushCache || this._brushCache.r !== r) {
      const offsets = [];
      const r_sq = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r_sq) {
            offsets.push({ dx, dy });
          }
        }
      }
      this._brushCache = { r, offsets };
    }

    // Apply cached offsets directly without math or conditionals
    const offsets = this._brushCache.offsets;
    const width = this.imageW;
    const height = this.imageH;
    const mask = this.mask;
    
    for (let i = 0; i < offsets.length; i++) {
        const px = cx + offsets[i].dx;
        const py = cy + offsets[i].dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
           mask[py * width + px] = classId;
        }
    }
    
    // Rendering is now deferred via requestAnimationFrame in _onMouseMove,
    // so we removed the synchronous renderAnnotation() call here.
  }

  _paintLine(from, to) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    // Huge optimization: Step by fraction of the brush radius instead of 1px at a time
    const r = Math.max(1, Math.round(this.brushSize / this.zoom));
    const stepDist = Math.max(1, r / 3); 
    const steps = Math.max(1, Math.ceil(dist / stepDist));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this._paintAt({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  }

  /* ── Undo / Redo ──────────────────────────────────────────────────────── */

  _pushUndo() {
    if (this.undoStack.length >= this.maxUndo) {
      this.undoStack.shift();
    }
    this.undoStack.push(new Uint8Array(this.mask));
    this.redoStack = [];
  }

  undo(onlyPolygon = false) {
    if (this.tool === 'polygon' && this.polyActive && this.polyNodes.length > 0) {
      this.polyNodes.pop();
      if (this.polyNodes.length === 0) {
        this.polyActive = false;
      }
      this.renderInteraction();
      return;
    }

    if (onlyPolygon) return;

    if (this.undoStack.length === 0) return;
    this.redoStack.push(new Uint8Array(this.mask));
    this.mask = this.undoStack.pop();
    this.renderAnnotation();
    if (window.app && window.app.renderZonesList) {
      window.app.renderZonesList();
      window.app.dirty = true;
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(new Uint8Array(this.mask));
    this.mask = this.redoStack.pop();
    this.renderAnnotation();
    if (window.app && window.app.renderZonesList) {
      window.app.renderZonesList();
      window.app.dirty = true;
    }
  }

  /* ── Utilities ────────────────────────────────────────────────────────── */

  _hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? {
      r: parseInt(m[1], 16),
      g: parseInt(m[2], 16),
      b: parseInt(m[3], 16),
    } : { r: 255, g: 0, b: 0 };
  }

  hasMaskData() {
    if (!this.mask) return false;
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] !== 0) return true;
    }
    return false;
  }

  // Extracts disjoint "zones" of annotations using a high-performance synchronous BFS
  getLabeledZones() {
    if (!this.mask) return [];
    
    const zones = [];
    const width = this.imageW;
    const height = this.imageH;
    const len = width * height;
    const visited = new Uint8Array(len);
    
    // Pre-allocate queue for performance
    const queue = new Int32Array(len);
    
    for (let i = 0; i < len; i++) {
      const classId = this.mask[i];
      if (classId !== 0 && visited[i] === 0) {
        
        // Found a new disjoint component!
        let qHead = 0;
        let qTail = 0;
        
        // Start BFS at pixel i
        queue[qTail++] = i;
        visited[i] = 1;
        
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        
        while (qHead < qTail) {
          const curr = queue[qHead++];
          
          const x = curr % width;
          const y = (curr / width) | 0; // fast integer division
          
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          
          // Check 4 neighbors
          // Left
          if (x > 0) {
             const n = curr - 1;
             if (visited[n] === 0 && this.mask[n] === classId) {
                 visited[n] = 1; queue[qTail++] = n;
             }
          }
          // Right
          if (x < width - 1) {
             const n = curr + 1;
             if (visited[n] === 0 && this.mask[n] === classId) {
                 visited[n] = 1; queue[qTail++] = n;
             }
          }
          // Up
          if (y > 0) {
             const n = curr - width;
             if (visited[n] === 0 && this.mask[n] === classId) {
                 visited[n] = 1; queue[qTail++] = n;
             }
          }
          // Down
          if (y < height - 1) {
             const n = curr + width;
             if (visited[n] === 0 && this.mask[n] === classId) {
                 visited[n] = 1; queue[qTail++] = n;
             }
          }
        }
        
        zones.push({
          classId: classId,
          pixels: queue.slice(0, qTail),
          minX, minY, maxX, maxY
        });
      }
    }
    
    return zones;
  }

  deleteZone(zone) {
    if (!this.mask || !zone || !zone.pixels) return;
    this._pushUndo();
    for (let i = 0; i < zone.pixels.length; i++) {
        this.mask[zone.pixels[i]] = 0;
    }
    this.renderAnnotation();
  }
}
