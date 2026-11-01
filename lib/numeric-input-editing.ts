/** Replace a zero default only when editing starts, without changing saved data on focus. */
export function installNumericInputEditing(doc: Document) {
  const edited = new WeakSet<HTMLInputElement>();
  const numeric = new WeakSet<HTMLInputElement>();
  const Input = doc.defaultView!.HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(Input.prototype, "value")!.set!;

  function isNumeric(input: HTMLInputElement) {
    // inputmode=numeric also serves phone numbers, PINs and codes. Those are
    // identifiers whose leading zeroes must be preserved.
    return input.type === "number" || (input.type === "text" && input.inputMode === "decimal");
  }

  function focus(event: Event) {
    if (!(event.target instanceof Input)) return;
    edited.delete(event.target);
    if (isNumeric(event.target)) numeric.add(event.target);
    else numeric.delete(event.target);
  }

  function beforeInput(event: Event) {
    const input = event.target;
    const edit = event as InputEvent;
    if (!(input instanceof Input) || input.disabled || input.readOnly ||
        (!isNumeric(input) && !numeric.has(input)) || edited.has(input) ||
        event.defaultPrevented || edit.isComposing || !edit.inputType.startsWith("insert")) return;
    if (!/^[+-]?(?:0+(?:\.0*)?|\.0+)$/.test(input.value)) return;
    // Don't erase a number when the browser would reject the inserted character.
    if (input.type === "number" && edit.data && !/^[\d.+-]/.test(edit.data)) return;

    // Bypass React's value tracker so the ensuing native input event still
    // reaches controlled onChange handlers, validators and autosave exactly once.
    // Keep type, min, max, step and required intact for native form validation.
    setValue.call(input, "");
  }

  function changed(event: Event) {
    if (event.target instanceof Input) edited.add(event.target);
  }

  doc.addEventListener("focusin", focus);
  doc.addEventListener("beforeinput", beforeInput);
  doc.addEventListener("input", changed);
  return () => {
    doc.removeEventListener("focusin", focus);
    doc.removeEventListener("beforeinput", beforeInput);
    doc.removeEventListener("input", changed);
  };
}
