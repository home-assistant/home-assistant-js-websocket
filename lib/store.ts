import { UnsubscribeFunc } from "./types.js";

// (c) Jason Miller
// Unistore - MIT license
// And then adopted to our needs + typescript

type Listener<State> = (state: State) => void;
type Action<State> = (
  state: State,
  ...args: any[]
) => Partial<State> | Promise<Partial<State>> | null;
type BoundAction<State> = (...args: any[]) => void;

export type Store<State> = {
  state: State | undefined;
  action(action: Action<State>): BoundAction<State>;
  setState(update: Partial<State>, overwrite?: boolean): void;
  clearState(): void;
  subscribe(listener: Listener<State>): UnsubscribeFunc;
};

export const createStore = <State>(state?: State): Store<State> => {
  let listeners: Listener<State>[] = [];

  function unsubscribe(listener: Listener<State> | null) {
    let out = [];
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === listener) {
        listener = null;
      } else {
        out.push(listeners[i]);
      }
    }
    listeners = out;
  }

  function setState(update: Partial<State>, overwrite: boolean): void {
    state = overwrite ? (update as State) : { ...state!, ...update };
    let currentListeners = listeners;
    for (let i = 0; i < currentListeners.length; i++) {
      currentListeners[i](state);
    }
  }

  /**
   * An observable state container, returned from {@link createStore}
   * @name store
   */

  return {
    get state() {
      return state;
    },

    /**
     * Create a bound copy of the given action function.
     * The bound returned function invokes action() and persists the result back to the store.
     * If the return value of `action` is a Promise, the resolved value will be used as state.
     * @param {Function} action	An action of the form `action(state, ...args) -> stateUpdate`
     * @returns {Function} boundAction()
     */
    action(action: Action<State>): BoundAction<State> {
      function apply(result: Partial<State>) {
        setState(result, false);
      }

      // Note: perf tests verifying this implementation: https://esbench.com/bench/5a295e6299634800a0349500
      return function () {
        let args = [state];
        for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
        // @ts-ignore
        let ret = action.apply(this, args);
        if (ret != null) {
          return ret instanceof Promise ? ret.then(apply) : apply(ret);
        }
      };
    },

    /**
     * Apply a partial state object to the current state, invoking registered listeners.
     * @param {Object} update				An object with properties to be merged into state
     * @param {Boolean} [overwrite=false]	If `true`, update will replace state instead of being merged into it
     */
    setState,

    clearState() {
      state = undefined;
    },

    /**
     * Register a listener function to be called whenever state is changed. Returns an `unsubscribe()` function.
     * @param {Function} listener	A function to call when state changes. Gets passed the new state.
     * @returns {Function} unsubscribe()
     */
    subscribe(listener: Listener<State>): UnsubscribeFunc {
      listeners.push(listener);
      return () => {
        unsubscribe(listener);
      };
    },

    // /**
    //  * Remove a previously-registered listener function.
    //  * @param {Function} listener	The callback previously passed to `subscribe()` that should be removed.
    //  * @function
    //  */
    // unsubscribe,
  };
};
