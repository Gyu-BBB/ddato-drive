export class UploadTransferLimiter {
  constructor(limit = 10) {
    this.limit = limit;
    this.accounts = new Map();
  }

  async run(accountId, callback) {
    let state = this.accounts.get(accountId);
    if (!state) {
      state = { active: 0, waiting: [] };
      this.accounts.set(accountId, state);
    }
    if (state.active >= this.limit) {
      await new Promise(resolve => state.waiting.push(resolve));
    } else {
      state.active += 1;
    }
    try {
      return await callback();
    } finally {
      const next = state.waiting.shift();
      if (next) next();
      else {
        state.active -= 1;
        if (!state.active) this.accounts.delete(accountId);
      }
    }
  }
}
