export function parseQuery<T>(queryString: string) {
  const query: any = {};
  const items = queryString.split("&");
  for (let i = 0; i < items.length; i++) {
    const item = items[i].split("=");
    const key = decodeURIComponent(item[0]);
    const value = item.length > 1 ? decodeURIComponent(item[1]) : undefined;
    query[key] = value;
  }
  return query as T;
}

// From: https://davidwalsh.name/javascript-debounce-function

// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
// eslint-disable-next-line: ban-types
export const debounce = <T extends (...args: any[]) => unknown>(
  func: T,
  wait: number,
  immediate = false
): T => {
  let timeout: number | undefined;
  // @ts-ignore
  return function (...args) {
    // @ts-ignore
    const context = this;
    const later = () => {
      timeout = undefined;
      if (!immediate) {
        func.apply(context, args);
      }
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) {
      func.apply(context, args);
    }
  };
};

export const atLeastHaVersion = (
  version: string,
  major: number,
  minor: number,
  patch?: number
): boolean => {
  const [haMajor, haMinor, haPatch] = version.split(".", 3);

  return (
    Number(haMajor) > major ||
    (Number(haMajor) === major &&
      (patch === undefined
        ? Number(haMinor) >= minor
        : Number(haMinor) > minor)) ||
    (patch !== undefined &&
      Number(haMajor) === major &&
      Number(haMinor) === minor &&
      Number(haPatch) >= patch)
  );
};
