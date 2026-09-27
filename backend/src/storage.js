import crypto from 'node:crypto';
import { StorageBlob } from './models.js';

export const storage = {
  async init() {
    // MongoDB is initialized in index.js
  },

  async put(buffer) {
    const ref = crypto.randomUUID();
    await StorageBlob.create({ ref, data: buffer });
    return ref;
  },

  async get(ref) {
    const doc = await StorageBlob.findOne({ ref });
    if (!doc) throw new Error('File not found');
    return doc.data;
  },

  async remove(ref) {
    await StorageBlob.deleteOne({ ref });
  },
};

export function sha256Hex(buffer) {
  return '0x' + crypto.createHash('sha256').update(buffer).digest('hex');
}

