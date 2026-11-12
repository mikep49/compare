// One worker per workspace, so a comparison in another workspace can finish
// independently. Cancelled jobs settle with null and never supply a result.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createDiffer = factory;
})(typeof self !== 'undefined' ? self : this, function createDiffer(WorkerClass = Worker) {
  let worker = null;
  let pending = null;

  function cancel() {
    worker?.terminate();
    worker = null;
    const job = pending;
    pending = null;
    job?.resolve(null);
  }

  function compare(kind, left, right, options) {
    if (pending) cancel();
    return new Promise((resolve, reject) => {
      const job = { resolve, reject };
      pending = job;
      const fail = (error) => {
        if (pending !== job) return;
        pending = null;
        worker?.terminate();
        worker = null;
        reject(error);
      };
      try {
        worker ??= new WorkerClass('diff-worker.js');
        worker.onmessage = (event) => {
          if (pending !== job) return;
          pending = null;
          resolve(event.data);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          fail(new Error(event.message || 'Comparison worker failed.'));
        };
        worker.onmessageerror = () => fail(new Error('Could not read the comparison result.'));
        worker.postMessage({ kind, left, right, options });
      } catch (error) {
        fail(error);
      }
    });
  }

  return { compare, cancel };
});
