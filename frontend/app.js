/* ═══════════════════════════════════════════════════════════════════════════
   app.js — Main application state & orchestration
   ═══════════════════════════════════════════════════════════════════════════ */

class App {
  constructor() {
    this.canvas  = new AnnotationCanvas();
    this.toolbar = new Toolbar(this);

    // State
    this.currentFolder = '';
    this.images = [];        // [{name, path, annotated}, ...]
    this.currentIndex = -1;
    this.classes = [];
    this.activeClassId = 0;
    this.dirty = false;

    this._bindUI();
    this._init();
  }

  async _init() {
    // Show shortcuts on load
    setTimeout(() => {
      document.getElementById('shortcutsOverlay').classList.add('visible');
    }, 800);
  }

  /* ── UI Bindings ──────────────────────────────────────────────────────── */

  _bindUI() {
    // Open folder button
    document.getElementById('btnOpenFolder').addEventListener('click', () => this.openFolder());

    // Save button
    document.getElementById('btnSave').addEventListener('click', () => this.saveAnnotation());

    // Search images
    document.getElementById('searchImages').addEventListener('input', (e) => {
      this.filterImages(e.target.value);
    });
  }

  /* ── Open Folder ──────────────────────────────────────────────────────── */

  async openFolder() {
    try {
      const result = await API.browse();
      this.currentFolder = result.current;
      this.images = result.items;

      // Update header
      document.getElementById('headerFolderName').textContent = result.current;
      document.getElementById('imageCount').textContent = this.images.length;

      // Render image list
      this.renderImageList();

      // Load classes
      await this.loadClasses();

      // Hide empty state
      document.getElementById('emptyState').classList.add('hidden');
      document.getElementById('shortcutsOverlay').classList.remove('visible');

      // Auto-load first image
      if (this.images.length > 0) {
        this.loadImageAt(0);
      }

      this.showToast(`Loaded ${this.images.length} images`, 'success');
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.showToast('Error opening folder: ' + err.message, 'error');
      }
    }
  }

  /* ── Image List ───────────────────────────────────────────────────────── */

  renderImageList(filter = '') {
    const list = document.getElementById('imageList');
    list.innerHTML = '';

    const filtered = filter
      ? this.images.filter(img => img.name.toLowerCase().includes(filter.toLowerCase()))
      : this.images;

    filtered.forEach((img, idx) => {
      const realIdx = this.images.indexOf(img);
      const li = document.createElement('li');
      if (realIdx === this.currentIndex) li.classList.add('active');
      li.innerHTML = `
        <span class="material-symbols-outlined">${img.annotated ? 'check_circle' : 'image'}</span>
        <span class="img-name">${img.name}</span>
        ${img.annotated ? '<span class="annotated-badge"></span>' : ''}
      `;
      li.addEventListener('click', () => this.loadImageAt(realIdx));
      list.appendChild(li);
    });
  }

  filterImages(query) {
    this.renderImageList(query);
  }

  /* ── Load Image ───────────────────────────────────────────────────────── */

  async loadImageAt(index) {
    if (index < 0 || index >= this.images.length) return;

    // Auto-save if dirty
    if (this.dirty && this.currentIndex >= 0) {
      await this.saveAnnotation(true);
    }

    this.currentIndex = index;
    const img = this.images[index];

    // Update UI
    this.renderImageList(document.getElementById('searchImages').value);
    document.getElementById('statusFile').textContent = img.name;
    document.getElementById('infoFile').textContent = img.name;
    document.getElementById('btnSave').disabled = false;

    // Revoke previous URL to prevent memory leaks
    if (this._currentObjectUrl) {
      URL.revokeObjectURL(this._currentObjectUrl);
      this._currentObjectUrl = null;
    }

    try {
      // Get image dimensions
      const info = await API.getImageInfo(img.path);
      document.getElementById('infoSize').textContent = `${info.width} × ${info.height}`;

      this._currentObjectUrl = info.url;

      // Load image onto canvas reusing the same URL
      await this.canvas.loadImage(info.url, info.width, info.height);
      this.canvas.setClasses(this.classes);

      // Load existing annotation if exists
      const ann = await API.getAnnotation(img.path);
      if (ann.exists && ann.data) {
        this.canvas.loadMask(ann.data, ann.shape, ann.dtype);
        document.getElementById('infoAnnotation').textContent = 'Loaded';
        document.getElementById('infoAnnotation').style.color = '#4CAF50';
        this.renderZonesList();
      } else {
        document.getElementById('infoAnnotation').textContent = 'None';
        document.getElementById('infoAnnotation').style.color = '#90a4ae';
      }

      this.dirty = false;

      // Track changes
      this._watchDirty();

    } catch (err) {
      this.showToast('Error loading image: ' + err.message, 'error');
    }
  }

  _watchDirty() {
    // Simple: mark dirty on any mouse down on annotation canvas
    const handler = () => {
      this.dirty = true;
      this.interCanvas?.removeEventListener('mousedown', handler);
    };
    // Using the interaction canvas since that's where events go
    const ic = document.getElementById('interactionCanvas');
    ic.addEventListener('mousedown', handler);
    // Store ref for cleanup
    this._dirtyHandler = handler;
    this._dirtyCanvas = ic;
  }

  prevImage() {
    if (this.currentIndex > 0) {
      this.loadImageAt(this.currentIndex - 1);
    }
  }

  nextImage() {
    if (this.currentIndex < this.images.length - 1) {
      this.loadImageAt(this.currentIndex + 1);
    }
  }

  /* ── Save Annotation ──────────────────────────────────────────────────── */

  async saveAnnotation(silent = false) {
    if (this.currentIndex < 0 || !this.canvas.mask) return;

    const img = this.images[this.currentIndex];
    try {
      if (!this.canvas.hasMaskData()) {
        // If image has no annotations, mark as un-annotated
        img.annotated = false;
        this.dirty = false;
        
        // Remove annotated icon
        const listItems = document.querySelectorAll('#imageList li');
        if (listItems[this.currentIndex]) {
          const iconSpan = listItems[this.currentIndex].querySelector('span.material-symbols-outlined');
          if (iconSpan) iconSpan.textContent = 'image';
          
          const badge = listItems[this.currentIndex].querySelector('.annotated-badge');
          if (badge) badge.remove();
        }

        document.getElementById('infoAnnotation').textContent = 'None';
        document.getElementById('infoAnnotation').style.color = '#90a4ae';
        
        // Delete the annotation file natively
        await API.deleteAnnotation(img.path, this.classes);
        
        this.renderZonesList();

        if (!silent) {
          this.showToast('Annotation cleared', 'success');
        }
        return;
      }

      const mask = this.canvas.getMask();
      const shape = [this.canvas.imageH, this.canvas.imageW];
      const zones = this.canvas.getLabeledZones();
      await API.saveAnnotation(img.path, mask, shape, this.classes, zones);

      // Update annotated status without full DOM rebuild
      img.annotated = true;
      this.dirty = false;
      
      // Selectively update just this item in the DOM
      const listItems = document.querySelectorAll('#imageList li');
      if (listItems[this.currentIndex]) {
        const iconSpan = listItems[this.currentIndex].querySelector('span.material-symbols-outlined');
        if (iconSpan) iconSpan.textContent = 'check_circle';
        
        if (!listItems[this.currentIndex].querySelector('.annotated-badge')) {
          listItems[this.currentIndex].insertAdjacentHTML('beforeend', '<span class="annotated-badge"></span>');
        }
      }

      document.getElementById('infoAnnotation').textContent = 'Saved ✓';
      document.getElementById('infoAnnotation').style.color = '#4CAF50';
      
      this.renderZonesList();

      if (!silent) {
        this.showToast('Annotation saved as .npy', 'success');
      }
    } catch (err) {
      this.showToast('Save error: ' + err.message, 'error');
    }
  }

  /* ── Class Management ─────────────────────────────────────────────────── */

  async loadClasses() {
    try {
      const result = await API.getClasses(this.currentFolder);
      this.classes = result.classes || [];
      if (this.classes.length > 0 && this.activeClassId === 0) {
        this.activeClassId = this.classes[0].id;
      }
      this.canvas.setClasses(this.classes);
      this.canvas.setActiveClass(this.activeClassId);
      this.toolbar.renderClassList(this.classes, this.activeClassId);
      this.renderZonesList();
    } catch (err) {
      console.warn('Failed to load classes:', err);
    }
  }

  setActiveClass(id) {
    this.activeClassId = id;
    this.canvas.setActiveClass(id);
    this.toolbar.renderClassList(this.classes, id);
  }

  /* ── Zone Listing ─────────────────────────────────────────────────────── */

  renderZonesList() {
    // Only implemented for visual updates
    setTimeout(() => {
      const zones = this.canvas.getLabeledZones();
      this.toolbar.renderClassList(this.classes, this.activeClassId, zones);
    }, 50);
  }

  async saveClasses() {
    if (!this.currentFolder) return;
    try {
      await API.saveClasses(this.currentFolder, this.classes);
    } catch (err) {
      this.showToast('Error saving classes: ' + err.message, 'error');
    }
  }

  /* ── Toast Notifications ──────────────────────────────────────────────── */

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.style.display = 'block';
    // Trigger reflow for animation
    void toast.offsetWidth;
    toast.classList.add('show');

    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 2500);
  }
}

/* ── Initialize ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
