/* ═══════════════════════════════════════════════════════════════════════════
   toolbar.js — Toolbar interactions, defect class management UI
   ═══════════════════════════════════════════════════════════════════════════ */

class Toolbar {
  constructor(app) {
    this.app = app;
    this._bindToolButtons();
    this._bindBrushSize();
    this._bindSubtract();
    this._bindOverlay();
    this._bindClassButtons();
    this._bindKeyboard();
    this.collapsedClasses = new Set();
  }

  /* ── Tool Buttons ─────────────────────────────────────────────────────── */

  _bindToolButtons() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectTool(btn.dataset.tool);
      });
    });

    document.getElementById('btnUndo').addEventListener('click', () => this.app.canvas.undo());
    document.getElementById('btnRedo').addEventListener('click', () => this.app.canvas.redo());
    document.getElementById('btnZoomIn').addEventListener('click', () => this.app.canvas.zoomIn());
    document.getElementById('btnZoomOut').addEventListener('click', () => this.app.canvas.zoomOut());
    document.getElementById('btnFitView').addEventListener('click', () => this.app.canvas.fitView());
  }

  selectTool(tool) {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');
    this.app.canvas.setTool(tool);

    const statusTool = document.getElementById('statusTool');
    if (statusTool) statusTool.textContent = tool.charAt(0).toUpperCase() + tool.slice(1);
  }

  /* ── Brush Size ───────────────────────────────────────────────────────── */

  _bindBrushSize() {
    const slider = document.getElementById('brushSize');
    const val = document.getElementById('brushSizeVal');
    slider.addEventListener('input', () => {
      val.textContent = slider.value;
      this.app.canvas.setBrushSize(parseInt(slider.value));
    });
  }

  /* ── Subtract Mode ────────────────────────────────────────────────────── */

  _bindSubtract() {
    const toggle = document.getElementById('subtractMode');
    toggle.addEventListener('change', () => {
      this.app.canvas.setSubtractMode(toggle.checked);
      const el = document.getElementById('statusMode');
      if (el) {
        el.textContent = toggle.checked ? 'SUBTRACT' : 'ADD';
        el.className = toggle.checked ? 'mode-subtract' : 'mode-add';
      }
    });
  }

  toggleSubtract() {
    const toggle = document.getElementById('subtractMode');
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event('change'));
  }

  /* ── Overlay ──────────────────────────────────────────────────────────── */

  _bindOverlay() {
    const toggleOverlay = document.getElementById('toggleOverlay');
    toggleOverlay.addEventListener('change', () => {
      this.app.canvas.setShowOverlay(toggleOverlay.checked);
    });

    const opacitySlider = document.getElementById('overlayOpacity');
    opacitySlider.addEventListener('input', () => {
      this.app.canvas.setOverlayOpacity(parseInt(opacitySlider.value) / 100);
    });
  }

  /* ── Class Management ─────────────────────────────────────────────────── */

  _bindClassButtons() {
    document.getElementById('btnAddClass').addEventListener('click', () => this.openClassModal('add'));
    document.getElementById('btnEditClass').addEventListener('click', () => this.openClassModal('edit'));
    document.getElementById('btnDeleteClass').addEventListener('click', () => this.deleteClass());

    document.getElementById('btnSaveClass').addEventListener('click', () => this.saveClass());
    document.getElementById('btnCancelClass').addEventListener('click', () => this.closeClassModal());
    document.getElementById('classModalClose').addEventListener('click', () => this.closeClassModal());

    document.getElementById('activeClassSelect').addEventListener('change', (e) => {
      const id = parseInt(e.target.value) || 0;
      this.app.setActiveClass(id);
    });
  }

  renderClassList(classes, activeId, zones = []) {
    // Update dropdown
    const select = document.getElementById('activeClassSelect');
    select.innerHTML = '<option value="">— Select label type —</option>';
    classes.forEach(cls => {
      const opt = document.createElement('option');
      opt.value = cls.id;
      opt.textContent = `NG: ${cls.name}`;
      opt.style.color = cls.color;
      if (cls.id === activeId) opt.selected = true;
      select.appendChild(opt);
    });

    // Update list
    const list = document.getElementById('classList');
    list.innerHTML = '';
    classes.forEach(cls => {
      const li = document.createElement('li');
      if (cls.id === activeId) li.classList.add('active');
      
      // Determine if there are zones for this class
      const clsZones = zones.filter(z => z.classId === cls.id);
      const isCollapsed = this.collapsedClasses.has(cls.id);
      
      const headerDiv = document.createElement('div');
      headerDiv.style.display = 'flex';
      headerDiv.style.alignItems = 'center';
      headerDiv.style.gap = '8px';
      headerDiv.style.width = '100%';
      headerDiv.style.cursor = 'pointer';
      
      let collapseIcon = '';
      if (clsZones.length > 0) {
        collapseIcon = `<span class="material-symbols-outlined" style="font-size:16px; opacity:0.6">${isCollapsed ? 'expand_more' : 'expand_less'}</span>`;
      }

      headerDiv.innerHTML = `
        <span class="class-swatch" style="background:${cls.color}"></span>
        <span style="flex:1;">${cls.name}</span>
        ${collapseIcon}
        <span class="class-id">#${cls.id}</span>
      `;
      
      li.appendChild(headerDiv);

      if (clsZones.length > 0 && !isCollapsed) {
        li.style.flexDirection = 'column';
        li.style.alignItems = 'stretch';
        
        const zoneList = document.createElement('ul');
        zoneList.className = 'zone-list';
        
        clsZones.forEach((z, idx) => {
          const zli = document.createElement('li');
          zli.className = 'zone-item';
          zli.innerHTML = `
            <span class="material-symbols-outlined" style="font-size:14px; opacity:0.6;">category</span>
            <span style="flex:1; font-size:11px; opacity:0.8;">Region ${idx + 1}</span>
            <button class="zone-action-btn" title="Delete Region" data-zone="${idx}">
              <span class="material-symbols-outlined" style="font-size:14px;">delete</span>
            </button>
          `;
          
          zli.querySelector('.zone-action-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.canvas.deleteZone(z);
            this.app.saveAnnotation(true); // Auto-save silently
          });
          
          zoneList.appendChild(zli);
        });
        li.appendChild(zoneList);
      }

      // Click listener for the header row
      headerDiv.addEventListener('click', (e) => {
        if (this.app.activeClassId === cls.id) {
          // Already active, toggle collapse
          if (this.collapsedClasses.has(cls.id)) {
            this.collapsedClasses.delete(cls.id);
          } else {
            this.collapsedClasses.add(cls.id);
          }
          if (this.app.renderZonesList) this.app.renderZonesList();
        } else {
          // Select it and make sure it's expanded
          this.collapsedClasses.delete(cls.id);
          this.app.setActiveClass(cls.id);
        }
      });

      list.appendChild(li);
    });
  }

  openClassModal(mode) {
    this._classModalMode = mode;
    const modal = document.getElementById('classModal');
    const title = document.getElementById('classModalTitle');
    const nameInput = document.getElementById('className');
    const colorInput = document.getElementById('classColor');

    if (mode === 'edit') {
      const cls = this.app.classes.find(c => c.id === this.app.activeClassId);
      if (!cls) {
        this.app.showToast('Select a class to edit', 'error');
        return;
      }
      title.textContent = 'Edit Defect Class';
      nameInput.value = cls.name;
      colorInput.value = cls.color;
    } else {
      title.textContent = 'Add Defect Class';
      nameInput.value = '';
      // Generate a random nice color
      const hue = Math.floor(Math.random() * 360);
      colorInput.value = this._hslToHex(hue, 70, 60);
    }
    modal.style.display = 'flex';
    nameInput.focus();
  }

  closeClassModal() {
    document.getElementById('classModal').style.display = 'none';
  }

  saveClass() {
    const name = document.getElementById('className').value.trim();
    const color = document.getElementById('classColor').value;
    if (!name) {
      this.app.showToast('Enter a class name', 'error');
      return;
    }

    if (this._classModalMode === 'edit') {
      const cls = this.app.classes.find(c => c.id === this.app.activeClassId);
      if (cls) {
        cls.name = name;
        cls.color = color;
      }
    } else {
      const maxId = this.app.classes.reduce((max, c) => Math.max(max, c.id), 0);
      this.app.classes.push({ id: maxId + 1, name, color });
      this.app.setActiveClass(maxId + 1);
    }

    this.closeClassModal();
    this.app.saveClasses();
    this.renderClassList(this.app.classes, this.app.activeClassId);
    this.app.canvas.setClasses(this.app.classes);
    this.app.canvas.renderAnnotation();
    this.app.showToast(`Class "${name}" saved`, 'success');
  }

  deleteClass() {
    const cls = this.app.classes.find(c => c.id === this.app.activeClassId);
    if (!cls) {
      this.app.showToast('Select a class to delete', 'error');
      return;
    }
    if (!confirm(`Delete defect class "${cls.name}"?`)) return;
    this.app.classes = this.app.classes.filter(c => c.id !== cls.id);
    this.app.setActiveClass(this.app.classes.length > 0 ? this.app.classes[0].id : 0);
    this.app.saveClasses();
    this.renderClassList(this.app.classes, this.app.activeClassId);
    this.app.canvas.setClasses(this.app.classes);
    this.app.canvas.renderAnnotation();
    this.app.showToast(`Class "${cls.name}" deleted`, 'success');
  }

  /* ── Keyboard Shortcuts ───────────────────────────────────────────────── */

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Skip if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      switch (e.key) {
        case '1': this.selectTool('polygon'); break;
        case '2': this.selectTool('brush'); break;
        case '3': this.selectTool('eraser'); break;
        case 'd': case 'D': this.app.canvas.addPolygonNode(); break;
        case 's':
          if (!e.ctrlKey) this.app.canvas.closePolygon();
          break;
        case 'S':
          if (!e.ctrlKey) this.app.canvas.closePolygon();
          break;
        case 'x': case 'X': this.toggleSubtract(); break;
        case 'z':
          if (e.ctrlKey) { e.preventDefault(); this.app.canvas.undo(); }
          else this.app.canvas.undo(true);
          break;
        case 'y':
          if (e.ctrlKey) { e.preventDefault(); this.app.canvas.redo(); }
          break;
        case 'f': case 'F': this.app.canvas.fitView(); break;
        case '+': case '=': this.app.canvas.zoomIn(); break;
        case '-': this.app.canvas.zoomOut(); break;
        case 'ArrowLeft': e.preventDefault(); this.app.prevImage(); break;
        case 'ArrowRight': e.preventDefault(); this.app.nextImage(); break;
        case '?':
          document.getElementById('shortcutsOverlay').classList.toggle('visible');
          break;
      }

      // Ctrl+S = save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.app.saveAnnotation();
      }
      // Ctrl+O = open folder
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        this.app.openFolderModal();
      }
    });
  }

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
}
