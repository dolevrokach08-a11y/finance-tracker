/* Durable, per-user payslip operation queue.
 *
 * UserStorage owns the per-user namespace for QUEUE_KEY. The coordinator is
 * transport-agnostic: tax-optimizer supplies a Firebase transaction adapter,
 * while tests supply an in-memory equivalent.
 */
(function (root) {
  'use strict';

  var QUEUE_KEY = 'tax_pending_payslip_ops';
  var APPLIED_LIMIT = 250;

  function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function samePayslip(existing, incoming) {
    if (!existing || !incoming) return false;
    if (existing.id != null && existing.id === incoming.id) return true;
    if (incoming.source === 'manual') return false;
    return (existing.month || '') === (incoming.month || '') &&
      (existing.earner || '') === (incoming.earner || '') &&
      (existing.source || '') === (incoming.source || '') &&
      (existing.fileName || '') === (incoming.fileName || '');
  }

  function applyOperation(payslips, operation) {
    var list = Array.isArray(payslips) ? clone(payslips) : [];
    if (!operation) return list;
    if (operation.type === 'upsert' && operation.payslip) {
      var incoming = clone(operation.payslip);
      var replaced = false;
      list = list.map(function (current) {
        if (!replaced && samePayslip(current, incoming)) {
          replaced = true;
          return incoming;
        }
        return current;
      });
      if (!replaced) list.push(incoming);
    } else if (operation.type === 'delete') {
      list = list.filter(function (current) {
        return current && current.id !== operation.payslipId;
      });
    }
    return list;
  }

  function create(options) {
    options = options || {};
    var storage = options.storage;
    var transact = options.transact;
    var onProjection = options.onProjection || function () {};
    var onStatus = options.onStatus || function () {};
    var makeId = options.makeId || function () {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    };
    var now = options.now || function () { return new Date(); };
    var stamp = options.stamp || function () { return {}; };
    var malformedReported = false;
    var queue = [];

    function emit(state, message) {
      onStatus({ state: state, pendingCount: queue.length, message: message || '' });
    }

    function load() {
      try {
        var raw = storage && storage.getItem(QUEUE_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('queue is not an array');
        return parsed.filter(function (op) {
          return op && op.opId && (op.type === 'upsert' || op.type === 'delete');
        });
      } catch (error) {
        if (!malformedReported) {
          malformedReported = true;
          emit('error', 'תור התלושים המקומי אינו קריא');
        }
        return [];
      }
    }

    function persist(nextQueue) {
      try {
        storage.setItem(QUEUE_KEY, JSON.stringify(nextQueue));
        queue = nextQueue;
        return true;
      } catch (error) {
        emit('error', 'לא ניתן לשמור את הפעולה במכשיר');
        return false;
      }
    }

    function readQueue() { return clone(queue); }
    function pendingCount() { return queue.length; }

    function project(remotePayslips) {
      return queue.reduce(applyOperation, Array.isArray(remotePayslips) ? clone(remotePayslips) : []);
    }

    function enqueueAdd(payslip) {
      var saved = clone(payslip || {});
      if (!saved.id) saved.id = 'p-' + makeId();
      var operation = { opId: makeId(), type: 'upsert', payslip: saved };
      if (!persist(queue.concat([operation]))) return null;
      onProjection(project(options.getBasePayslips ? options.getBasePayslips() : []));
      emit('stored-local');
      emit('pending');
      return saved;
    }

    function enqueueDelete(payslipId) {
      var operation = { opId: makeId(), type: 'delete', payslipId: payslipId };
      if (!persist(queue.concat([operation]))) return false;
      onProjection(project(options.getBasePayslips ? options.getBasePayslips() : []));
      emit('stored-local');
      emit('pending');
      return true;
    }

    async function flush() {
      if (!queue.length) { emit('cloud'); return true; }
      if (typeof transact !== 'function') { emit('error', 'אין חיבור מאובטח לענן'); return false; }
      var batch = clone(queue);
      var committedPayslips;
      emit('syncing');
      try {
        committedPayslips = await transact(async function (transaction) {
          var latest = await transaction.get();
          latest = latest && typeof latest === 'object' ? latest : {};
          var payslips = Array.isArray(latest.payslips) ? clone(latest.payslips) : [];
          var applied = Array.isArray(latest.taxPayslipAppliedOps) ? latest.taxPayslipAppliedOps.slice() : [];
          var appliedSet = new Set(applied);

          batch.forEach(function (operation) {
            if (appliedSet.has(operation.opId)) return;
            payslips = applyOperation(payslips, operation);
            applied.push(operation.opId);
            appliedSet.add(operation.opId);
          });
          if (applied.length > APPLIED_LIMIT) applied = applied.slice(-APPLIED_LIMIT);

          var at = now();
          var patch = Object.assign({
            payslips: payslips,
            taxPayslipAppliedOps: applied,
            lastModified: (at instanceof Date ? at : new Date(at)).toISOString()
          }, stamp() || {});
          transaction.set(patch);
          return payslips;
        });

        var committedIds = new Set(batch.map(function (operation) { return operation.opId; }));
        var remaining = queue.filter(function (operation) { return !committedIds.has(operation.opId); });
        if (!persist(remaining)) return false;
        onProjection(clone(committedPayslips || []));
        emit(queue.length ? 'pending' : 'cloud');
        return true;
      } catch (error) {
        emit('error', error && error.message ? error.message : 'סנכרון התלושים נכשל');
        return false;
      }
    }

    queue = load();
    if (queue.length) emit('pending');
    return {
      enqueueAdd: enqueueAdd,
      enqueueDelete: enqueueDelete,
      project: project,
      flush: flush,
      pendingCount: pendingCount,
      readQueue: readQueue
    };
  }

  root.PayslipSync = { QUEUE_KEY: QUEUE_KEY, applyOperation: applyOperation, create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
