"""
DaNo Data Annotation Tool - Backend Server
FastAPI server for image browsing, loading, and annotation (.npy) storage.
"""

import os
import json
import base64
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="DaNo Annotation Server", version="1.0.0")

# CORS for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def is_image_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


# ── Browse filesystem ──────────────────────────────────────────────────────────
@app.get("/api/browse")
def browse(path: str = Query("", description="Directory path to browse")):
    """List folders and image files at the given path."""
    if not path:
        # Return drive roots on Windows or root on Linux
        import string
        drives = []
        if os.name == 'nt':
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if os.path.isdir(drive):
                    drives.append({"name": f"{letter}:", "path": drive, "type": "drive"})
        else:
            drives.append({"name": "Root", "path": "/", "type": "drive"})
            if os.path.isdir("/app/data"):
                drives.append({"name": "Data", "path": "/app/data", "type": "drive"})
        return {"items": drives, "current": ""}

    target = Path(path)
    if not target.exists():
        raise HTTPException(404, f"Path not found: {path}")
    if not target.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")

    items = []
    try:
        for entry in sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith(".") or entry.name.startswith("_"):
                continue
            if entry.is_dir():
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "folder",
                })
            elif is_image_file(entry.name):
                # Check if annotation exists
                ann_path = entry.parent / f"{entry.stem}_annotation.npy"
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "image",
                    "annotated": ann_path.exists(),
                })
    except PermissionError:
        raise HTTPException(403, f"Permission denied: {path}")

    parent = str(target.parent) if target.parent != target else ""
    return {"items": items, "current": str(target), "parent": parent}


# ── Serve image ────────────────────────────────────────────────────────────────
@app.get("/api/image")
def get_image(path: str = Query(..., description="Full path to image file")):
    """Serve an image file."""
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(404, f"Image not found: {path}")
    if not is_image_file(p.name):
        raise HTTPException(400, "Not an image file")
    return FileResponse(str(p), media_type=f"image/{p.suffix.lstrip('.').lower()}")


# ── Image dimensions ──────────────────────────────────────────────────────────
@app.get("/api/image-info")
def get_image_info(path: str = Query(..., description="Full path to image file")):
    """Get image dimensions."""
    from PIL import Image
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, f"Image not found: {path}")
    with Image.open(str(p)) as img:
        w, h = img.size
    return {"width": w, "height": h, "path": str(p)}


# ── Annotation I/O ────────────────────────────────────────────────────────────
@app.get("/api/annotation")
def get_annotation(path: str = Query(..., description="Full path to image file")):
    """Load .npy annotation map for a given image."""
    p = Path(path)
    ann_path = p.parent / f"{p.stem}_annotation.npy"
    if not ann_path.exists():
        return {"exists": False, "data": None}

    arr = np.load(str(ann_path))
    # Send as base64-encoded raw bytes
    data_b64 = base64.b64encode(arr.tobytes()).decode("ascii")
    return {
        "exists": True,
        "data": data_b64,
        "shape": list(arr.shape),
        "dtype": str(arr.dtype),
    }


class AnnotationSave(BaseModel):
    image_path: str
    data: str  # base64-encoded uint8 array
    shape: list  # [height, width]


@app.post("/api/annotation")
def save_annotation(body: AnnotationSave):
    """Save annotation map as .npy in the same folder as the image."""
    p = Path(body.image_path)
    if not p.parent.exists():
        raise HTTPException(400, f"Image folder not found: {p.parent}")

    raw = base64.b64decode(body.data)
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(body.shape)
    ann_path = p.parent / f"{p.stem}_annotation.npy"
    np.save(str(ann_path), arr)
    return {"saved": True, "path": str(ann_path)}


# ── Defect classes I/O ─────────────────────────────────────────────────────────
@app.get("/api/classes")
def get_classes(folder: str = Query(..., description="Folder path")):
    """Load defect class definitions from _classes.json in the image folder."""
    p = Path(folder) / "_classes.json"
    if not p.exists():
        # Return defaults
        return {
            "classes": [
                {"id": 1, "name": "Scratch", "color": "#FF6B6B"},
                {"id": 2, "name": "Dent", "color": "#4ECDC4"},
                {"id": 3, "name": "Burn", "color": "#FFE66D"},
                {"id": 4, "name": "Stain", "color": "#A06CD5"},
            ]
        }
    with open(str(p), "r") as f:
        return json.load(f)


class ClassesSave(BaseModel):
    folder: str
    classes: list


@app.post("/api/classes")
def save_classes(body: ClassesSave):
    """Save defect class definitions to _classes.json in the folder."""
    p = Path(body.folder) / "_classes.json"
    with open(str(p), "w") as f:
        json.dump({"classes": body.classes}, f, indent=2)
    return {"saved": True, "path": str(p)}


# ── Serve frontend ─────────────────────────────────────────────────────────────
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
