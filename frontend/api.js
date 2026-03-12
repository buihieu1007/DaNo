/* ═══════════════════════════════════════════════════════════════════════════
   api.js — Local File System API layer (Bypasses Python backend)
   ═══════════════════════════════════════════════════════════════════════════ */

const API = {
  dirHandle: null,

  async browse(path = '') {
    this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const items = [];
    
    for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|bmp|tif|tiff|webp)$/i)) {
        let annotated = false;
        try {
          const annName = entry.name.replace(/\.[^/.]+$/, "") + '_annotation.npy';
          await this.dirHandle.getFileHandle(annName);
          annotated = true;
        } catch(e) {}
        
        items.push({
          name: entry.name,
          path: entry.name,
          type: 'image',
          annotated: annotated
        });
      }
    }
    
    // Sort items alphabetically
    items.sort((a,b) => a.name.localeCompare(b.name));
    
    return { items, current: this.dirHandle.name, parent: '' };
  },

  async imageUrl(path) {
    if (!this.dirHandle) throw new Error("No folder opened");
    const fileHandle = await this.dirHandle.getFileHandle(path);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  },

  async getImageInfo(path) {
    const url = await this.imageUrl(path);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height, path: path, url: url });
      img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
      img.src = url;
    });
  },

  async getAnnotation(imagePath) {
    if (!this.dirHandle) throw new Error("No folder opened");
    const annName = imagePath.replace(/\.[^/.]+$/, "") + '_annotation.npy';
    try {
      const fileHandle = await this.dirHandle.getFileHandle(annName);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      
      const uint8 = new Uint8Array(buffer);
      const dataView = new DataView(buffer);
      const headerLen = dataView.getUint16(8, true);
      const offset = 10 + headerLen;
      
      const shapeStr = new TextDecoder().decode(uint8.slice(10, offset));
      const shapeMatch = shapeStr.match(/'shape':\s*\(\s*(\d+),\s*(\d+)\s*,?\)/);
      const shape = shapeMatch ? [parseInt(shapeMatch[1]), parseInt(shapeMatch[2])] : [0,0];
      
      const data = uint8.slice(offset);
      
      return { exists: true, data: data, shape: shape, dtype: 'uint8' };
    } catch(e) {
      return { exists: false, data: null };
    }
  },

  async _writeNpy(dirHandle, filename, dataArray, shape) {
    const magic = new Uint8Array([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59, 0x01, 0x00]);
    const dictStr = `{'descr': '|u1', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`;
    const totalDictLen = dictStr.length + 1;
    const r = (10 + totalDictLen) % 64;
    const padLen = r === 0 ? 0 : 64 - r;
    const dictStrPadded = dictStr + ' '.repeat(padLen) + '\n';
    
    const headerLenBytes = new Uint8Array(2);
    const dataView = new DataView(headerLenBytes.buffer);
    dataView.setUint16(0, dictStrPadded.length, true);
    
    const encoder = new TextEncoder();
    const dictBytes = encoder.encode(dictStrPadded);
    
    const npyFile = new Uint8Array(magic.length + 2 + dictBytes.length + dataArray.length);
    let offset = 0;
    npyFile.set(magic, offset); offset += magic.length;
    npyFile.set(headerLenBytes, offset); offset += 2;
    npyFile.set(dictBytes, offset); offset += dictBytes.length;
    npyFile.set(dataArray, offset);
    
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(npyFile);
    await writable.close();
  },

  async saveAnnotation(imagePath, mask, shape, classesInfo, zones) {
    if (!this.dirHandle) throw new Error("No folder opened");
    const baseName = imagePath.replace(/\.[^/.]+$/, ""); // original image name without extension
    const fullShapeArraySize = shape[0] * shape[1];
    
    // Create folders and save files per class present in mask
    for (const cls of classesInfo) {
      // 1. Isolate the mask for just this class
      const classMask = new Uint8Array(fullShapeArraySize);
      let classHasData = false;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === cls.id) {
          classMask[i] = 1; // Or maintain cls.id if preferred, but usually binary masks are saved per-class
          classHasData = true;
        }
      }

      if (classHasData) {
        // Create or get the NG_type directory
        const ngDir = await this.dirHandle.getDirectoryHandle(cls.name, { create: true });
        await this._writeNpy(ngDir, baseName + '.npy', classMask, shape);

        // Filter isolated zones for this class
        const clsZones = zones.filter(z => z.classId === cls.id);
        if (clsZones.length > 0) {
          const singleDir = await this.dirHandle.getDirectoryHandle(cls.name + "-single", { create: true });
          
          for (let zIdx = 0; zIdx < clsZones.length; zIdx++) {
            const zone = clsZones[zIdx];
            const singleMask = new Uint8Array(fullShapeArraySize);
            for (let i = 0; i < zone.pixels.length; i++) {
              singleMask[zone.pixels[i]] = 1;
            }
            await this._writeNpy(singleDir, `${baseName}_${zIdx + 1}.npy`, singleMask, shape);
          }
        }
      }
    }
    
    // Write out the master single file so that loading functions still work
    await this._writeNpy(this.dirHandle, baseName + '_annotation.npy', mask, shape);

    return { saved: true };
  },

  async deleteAnnotation(imagePath, classesInfo = []) {
    if (!this.dirHandle) throw new Error("No folder opened");
    const baseName = imagePath.replace(/\.[^/.]+$/, "");
    const annName = baseName + '_annotation.npy';
    
    try {
      await this.dirHandle.removeEntry(annName);
    } catch (e) {
      // Ignore main file missing
    }

    // Try to delete class-specific ones
    for (const cls of classesInfo) {
      try {
        const ngDir = await this.dirHandle.getDirectoryHandle(cls.name);
        await ngDir.removeEntry(baseName + '.npy');
      } catch (e) {}

      try {
        const singleDir = await this.dirHandle.getDirectoryHandle(cls.name + "-single");
        // We don't know exactly how many, try removing up to 20
        for (let i = 1; i <= 20; i++) {
          try {
            await singleDir.removeEntry(`${baseName}_${i}.npy`);
          } catch(e) {
            break; // assume no more once one fails
          }
        }
      } catch (e) {}
    }

    return { deleted: true };
  },

  async getClasses(folder) {
    if (!this.dirHandle) return { classes: [] };
    try {
      const fileHandle = await this.dirHandle.getFileHandle('_classes.json');
      const file = await fileHandle.getFile();
      const txt = await file.text();
      return JSON.parse(txt);
    } catch(e) {
      return {
        classes: [
          { id: 1, name: "Scratch", color: "#FF6B6B" },
          { id: 2, name: "Dent", color: "#4ECDC4" },
          { id: 3, name: "Burn", color: "#FFE66D" },
          { id: 4, name: "Stain", color: "#A06CD5" },
        ]
      };
    }
  },

  async saveClasses(folder, classes) {
    if (!this.dirHandle) return;
    const fileHandle = await this.dirHandle.getFileHandle('_classes.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ classes }, null, 2));
    await writable.close();
    return { saved: true };
  }
};
