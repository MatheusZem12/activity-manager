const timers = new Map();

function schedule(id, dueAt, callback) {
  cancel(id);
  const now = Date.now();
  const delay = Math.max(0, dueAt - now);
  const timer = setTimeout(() => {
    timers.delete(id);
    callback();
  }, delay);
  timers.set(id, timer);
}

function cancel(id) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function cancelAll() {
  for (const [id, timer] of timers) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function activeIds() {
  return Array.from(timers.keys());
}

module.exports = {
  schedule,
  cancel,
  cancelAll,
  activeIds
};
