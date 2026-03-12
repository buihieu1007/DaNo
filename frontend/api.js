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
    
    const writeTasks = [];

    // Create folders and save files per class using the pre-calculated zones
    const classesWithZones = classesInfo.filter(cls => zones.some(z => z.classId === cls.id));

    for (const cls of classesWithZones) {
      await new Promise(r => setTimeout(r, 0)); // Yield thread to keep UI alive
      
      const clsZones = zones.filter(z => z.classId === cls.id);
      
      // 1. Isolate the mask for just this class using only annotated pixels
      const classMask = new Uint8Array(fullShapeArraySize);
      for (let zIdx = 0; zIdx < clsZones.length; zIdx++) {
        const zonePixels = clsZones[zIdx].pixels;
        for (let i = 0; i < zonePixels.length; i++) {
          classMask[zonePixels[i]] = 1;
        }
      }

      // Create or get the NG_type directory
      writeTasks.push((async () => {
        const ngDir = await this.dirHandle.getDirectoryHandle(cls.name, { create: true });
        await this._writeNpy(ngDir, baseName + '.npy', classMask, shape);
      })());

      // Save isolated zones for this class
      writeTasks.push((async () => {
        const singleDir = await this.dirHandle.getDirectoryHandle(cls.name + "-single", { create: true });
        const zoneTasks = [];
        
        for (let zIdx = 0; zIdx < clsZones.length; zIdx++) {
          if (zIdx % 2 === 0) await new Promise(r => setTimeout(r, 0)); // Yield thread occasionally
          
          const zone = clsZones[zIdx];
          const singleMask = new Uint8Array(fullShapeArraySize);
          for (let i = 0; i < zone.pixels.length; i++) {
            singleMask[zone.pixels[i]] = 1;
          }
          zoneTasks.push(this._writeNpy(singleDir, `${baseName}_${zIdx + 1}.npy`, singleMask, shape));
        }
        await Promise.all(zoneTasks);
      })());
    }
    
    // Write out the master single file so that loading functions still work
    writeTasks.push(this._writeNpy(this.dirHandle, baseName + '_annotation.npy', mask, shape));

    await Promise.all(writeTasks);
    return { saved: true };
  },

  async deleteAnnotation(imagePath, classesInfo = []) {
    if (!this.dirHandle) throw new Error("No folder opened");
    const baseName = imagePath.replace(/\.[^/.]+$/, "");
    const annName = baseName + '_annotation.npy';
    
    const deleteTasks = [];

    deleteTasks.push((async () => {
      try {
        await this.dirHandle.removeEntry(annName);
      } catch (e) {}
    })());

    // Try to delete class-specific ones
    for (const cls of classesInfo) {
      deleteTasks.push((async () => {
        try {
          const ngDir = await this.dirHandle.getDirectoryHandle(cls.name);
          await ngDir.removeEntry(baseName + '.npy');
        } catch (e) {}
      })());

      deleteTasks.push((async () => {
        try {
          const singleDir = await this.dirHandle.getDirectoryHandle(cls.name + "-single");
          const zoneTasks = [];
          for (let i = 1; i <= 20; i++) {
            zoneTasks.push(singleDir.removeEntry(`${baseName}_${i}.npy`).catch(() => {}));
          }
          await Promise.all(zoneTasks);
        } catch (e) {}
      })());
    }

    await Promise.all(deleteTasks);
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
