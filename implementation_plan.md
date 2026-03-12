# Data Annotation Web UI for Surface Defect Detection

A web-based data annotation tool inspired by the **UnitX CorteX/OptiX** software (v4.6.0), focused specifically on the **Label Editor** functionality for surface defect detection. Annotations are saved as `.npy` pixel-wise masks in the same folder as the source images.

---

## Main Functions Understood from the Manual

### UnitX CorteX Software (AI Platform)
| Function | Description |
|---|---|
| **Network Management** | Create, clone, archive, import/export defect detection networks |
| **Label Page** | Browse images associated with a network; view label & batch status |
| **Label Editor** | Core annotation tool with Polygon and Magic Wand drawing tools |
| **NG-Type Classification** | Dropdown to assign defect categories (Scratch, Gouge, Burn, Dust, etc.) |
| **Add/Subtract Mode** | Toggle to add or cut from existing annotation selections |
| **AI Assistant (Show Prediction)** | Overlay current model predictions to guide labeling |
| **Label Scoring** | AI-guided tool suggesting labels where model needs improvement |
| **Training Hub** | Train from Scratch or Train Incremental with new data |
| **Merge Labels** | Copy specific labels between different networks |
| **Validation Metrics** | Confusion matrices, IoU charts, and loss curves |

### UnitX OptiX Software (Production Edge)
| Function | Description |
|---|---|
| **Live Dashboard** | Real-time inspection stats, disk usage, system monitoring |
| **Recipe Set-up** | Define Regions of Interest (ROI) and map captures to networks |
| **Data Pipeline / Sequences** | Tie PLC triggers to lighting channels and camera exposures |
| **NG Breakdown & Thresholds** | Defect metrics (area, width, length, count) that trigger NG status |
| **Manual Defect Mode** | Factory floor override to manually mark parts as OK/NG |

---

## Scope: Data Annotation Feature Only

We will implement **only the Label Editor / data annotation functionality**:

1. **Image folder browsing** — select a folder of images to annotate
2. **Image viewer** — display images with zoom, pan, and navigation
3. **Annotation tools** — Polygon tool, Brush tool, Eraser
4. **Defect class management** — create/rename/delete NG-types with color coding
5. **Annotation map storage** — save pixel-wise label masks as `.npy` files in the same image folder
6. **Load existing annotations** — auto-load `.npy` if present alongside an image

---

## Proposed Changes

### Architecture

```
D:\OptiX-clone\
├── backend/
│   ├── server.py          [NEW] FastAPI server for file I/O
│   └── requirements.txt   [NEW] Python dependencies
├── frontend/
│   ├── index.html         [NEW] Main HTML page
│   ├── style.css          [NEW] All styling
│   ├── app.js             [NEW] Main app logic & state
│   ├── canvas.js          [NEW] Canvas rendering & annotation tools
│   ├── toolbar.js         [NEW] Toolbar & defect class UI
│   └── api.js             [NEW] API communication layer
└── README.md              [NEW] Setup & usage instructions
```

---

### Backend (Python FastAPI)

#### [NEW] [server.py](file:///D:/OptiX-clone/backend/server.py)
- `GET /api/browse?path=` — list folders and image files at a given path
- `GET /api/image?path=` — serve an image file
- `GET /api/annotation?path=` — load `.npy` annotation map for a given image
- `POST /api/annotation` — save annotation map as `.npy` to the same folder as the image (filename: `{image_stem}_annotation.npy`)
- `GET /api/classes?path=` — load defect class definitions from `_classes.json` in the image folder
- `POST /api/classes` — save defect class definitions

#### [NEW] [requirements.txt](file:///D:/OptiX-clone/backend/requirements.txt)
- `fastapi`, `uvicorn`, `numpy`, `Pillow`, `python-multipart`

---

### Frontend (Vanilla HTML/CSS/JS)

#### [NEW] [index.html](file:///D:/OptiX-clone/frontend/index.html)
- Three-panel layout: **File Browser** (left) | **Canvas Viewer** (center) | **Tools & Classes** (right)
- Includes all JS modules and CSS

#### [NEW] [style.css](file:///D:/OptiX-clone/frontend/style.css)
- Dark theme with premium glassmorphism aesthetic
- Smooth transitions and micro-animations
- Responsive panel layout

#### [NEW] [app.js](file:///D:/OptiX-clone/frontend/app.js)
- Application state management (current image, current tool, annotation data, classes)
- Image navigation (prev/next)
- Auto-save and auto-load of annotations

#### [NEW] [canvas.js](file:///D:/OptiX-clone/frontend/canvas.js)
- HTML5 Canvas-based image rendering with zoom/pan
- Annotation overlay layer (semi-transparent colored masks)
- **Polygon tool**: click to place nodes, close to fill polygon (hotkeys: `D` add node, `S` close)
- **Brush tool**: paint with configurable radius
- **Eraser tool**: erase annotations with configurable radius
- Annotation data stored as a 2D integer array matching image dimensions (0 = no label, 1..N = class ID)

#### [NEW] [toolbar.js](file:///D:/OptiX-clone/frontend/toolbar.js)
- Tool selection buttons (Polygon, Brush, Eraser)
- Brush/eraser size slider
- Defect class (NG-type) list with add/rename/delete
- Color picker for each class
- Opacity slider for annotation overlay
- Undo/Redo buttons

#### [NEW] [api.js](file:///D:/OptiX-clone/frontend/api.js)
- Fetch wrappers for all backend endpoints
- Error handling and loading states

---

## User Review Required

> [!IMPORTANT]
> **Annotation file naming convention**: Each image `foo.png` will have its annotation saved as `foo_annotation.npy` in the **same folder**. A `_classes.json` file will also be stored in the folder to define defect class names and colors. Is this naming convention acceptable?

> [!NOTE]
> The `.npy` file will contain a 2D `uint8` NumPy array with shape `(height, width)` where `0` = unlabeled and `1..N` = defect class IDs. This supports up to 255 defect classes per image.

---

## Verification Plan

### Automated Tests
- **Backend API test**: Run `python -m pytest backend/test_server.py` (basic endpoint smoke tests)
- This is a new project so no existing tests exist

### Browser Verification (Primary)
1. Start the backend: `cd D:\OptiX-clone\backend && python server.py`
2. Open `http://localhost:8000` in Chrome
3. Verify: Browse to a folder containing images
4. Verify: Click an image to load it on the canvas
5. Verify: Select the Polygon tool, draw a polygon around a defect, close it
6. Verify: Select the Brush tool, paint over a defect area
7. Verify: Assign a defect class to the annotation
8. Verify: Save annotation → check that `{image_stem}_annotation.npy` appears in the image folder
9. Verify: Navigate away and back → annotation auto-loads from `.npy`
10. Verify: Zoom/pan the image with mouse wheel and drag

### Manual Verification
- The user should place some sample images in a test folder and try the full annotation workflow end-to-end
