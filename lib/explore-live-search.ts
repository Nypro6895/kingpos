/** One pending search per input; submit, selection and composition cancel it. */
export function createExploreLiveSearchScheduler() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  return {
    cancel,
    schedule(value: string, search: (query: string) => void) {
      cancel();
      timer = setTimeout(() => { timer = undefined; search(value.trim()); }, 450);
    },
  };
}
