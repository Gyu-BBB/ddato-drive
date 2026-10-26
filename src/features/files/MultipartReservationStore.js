import fs from 'node:fs';

const reservations = new Map();

export const multipartReservationStore = {
  hasActive() { return reservations.size > 0; },
  reserve(req, bytes) { reservations.set(req, { ownerId: req.user.id, bytes, path: '' }); },
  setPath(req, filePath) { const reservation = reservations.get(req); if (reservation) reservation.path = filePath; },
  release(req) { reservations.delete(req); },
  pendingBytes({ ownerId, excludeRequest } = {}) {
    return this.sum({ ownerId, excludeRequest }, reservation => reservation.bytes);
  },
  remainingBytes({ excludeRequest } = {}) {
    return this.sum({ excludeRequest }, reservation => {
      let written = 0;
      try { if (reservation.path) written = fs.statSync(reservation.path).size; } catch {}
      return Math.max(0, reservation.bytes - written);
    });
  },
  sum({ ownerId, excludeRequest }, amount) {
    let bytes = 0;
    for (const [req, reservation] of reservations) {
      if (req !== excludeRequest && (!ownerId || reservation.ownerId === ownerId)) bytes += amount(reservation);
    }
    return bytes;
  }
};
