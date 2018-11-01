import { UnsubscribeFunc } from "./types";

// (c) Jason Miller
// Unistore - MIT license
// And then adopted to our needs + typescript

type Listener<State> = (state: State) => void;

export class Store<State> {
  listeners: Listener<State>[];
  state: State | undefined;

  constructor() {
    this.listeners = [];
  }

  /**
   * Create a bound copy of the given action function.
   * The bound returned function invokes action() and persists the result back to the store.
   * If the return value of `action` is a Promise, the resolved value will be used as state.
   * @param {Function} action An action of the form `action(state, ...args) -> stateUpdate`
   * @returns {Function} boundAction()
   */
  action(
    action: (
      state: State,
      ...args: any[]
    ) => Partial<State> | Promise<Partial<State>> | null
  ) {
    const apply = (result: Partial<State>) => this.setState(result, false);

    // Note: perf tests verifying this implementation: https://esbench.com/bench/5a295e6299634800a0349500
    return (...args: any[]) => {
      const ret = action(this.state as State, ...args);
      if (ret != null) {
        return "then" in ret ? ret.then(apply) : apply(ret);
      }
    };
  }

  setState(update: Partial<State>, overwrite?: boolean) {
    this.state = overwrite
      ? (update as State)
      : Object.assign({}, this.state, update);
    const currentListeners = this.listeners;
    for (let i = 0; i < currentListeners.length; i++) {
      currentListeners[i](this.state);
    }
  }

  /**
   * Register a listener function to be called whenever state is changed. Returns an `unsubscribe()` function.
   * @param {Function} listener A function to call when state changes. Gets passed the new state.
   * @returns {Function} unsubscribe()
   */
  subscribe(listener: Listener<State>): UnsubscribeFunc {
    this.listeners.push(listener);
    if (this.state !== undefined) listener(this.state);
    return () => {
      this.unsubscribe(listener);
    };
  }

  /**
   * Remove a previously-registered listener function.
   * @param {Function} listener The callback previously passed to `subscribe()` that should be removed.
   * @function
   */
  unsubscribe(listener: Listener<State>) {
    let toFind: Listener<State> | null = listener;
    const out = [];
    const listeners = this.listeners;
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === toFind) {
        toFind = null;
      } else {
        out.push(listeners[i]);
      }
    }
    this.listeners = out;
  }
}
