export function createStore(initialState = {}) {
    let state = Object.freeze({ ...initialState });
    const listeners = new Set();

    function getState() {
        return state;
    }

    function setState(patch, reason = 'update') {
        const nextPatch = typeof patch === 'function' ? patch(state) : patch;
        if (!nextPatch || typeof nextPatch !== 'object') return state;
        const previous = state;
        state = Object.freeze({ ...state, ...nextPatch });
        listeners.forEach(listener => {
            try { listener(state, previous, reason); }
            catch (error) { console.error('[store] subscriber failed', error); }
        });
        return state;
    }

    function subscribe(listener, { immediate = false } = {}) {
        listeners.add(listener);
        if (immediate) listener(state, state, 'subscribe');
        return () => listeners.delete(listener);
    }

    return { getState, setState, subscribe };
}

