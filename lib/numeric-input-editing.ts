/** Only arithmetic fields opt in; numeric keyboards also serve PINs and ZIPs. */
function isArithmeticInput(input: EventTarget | null): input is HTMLInputElement {
  return input instanceof HTMLInputElement && !input.disabled && !input.readOnly
    && (input.type === "number" || (input.type === "text" && input.inputMode === "decimal"));
}

const initialZeros = new WeakSet<HTMLInputElement>();
const isZero = (value: string) => /^-?0+(?:\.0+)?$/.test(value);
function setBrowserValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
}

export function rememberNumericZero(event: Pick<Event, "target">) {
  const input = event.target;
  if (!isArithmeticInput(input)) return;
  if (isZero(input.value)) initialZeros.add(input);
  else initialZeros.delete(input);
}

export function replaceInitialNumericZero(event: Event) {
  const input = event.target;
  if (!isArithmeticInput(input) || !(event instanceof InputEvent)) return;
  const firstEdit = initialZeros.delete(input);
  // Only the first typed digit replaces a formatted default such as 0.00.
  // Later digits in an intentional decimal draft (0.02) must remain intact.
  if (firstEdit && !event.isComposing && event.inputType === "insertText"
    && /^\d+$/.test(event.data ?? "") && isZero(input.value)) setBrowserValue(input, "");
}

export function normalizeNumericInput(event: Event) {
  const input = event.target;
  if (!isArithmeticInput(input) || (event instanceof InputEvent && event.isComposing)) return;
  initialZeros.delete(input);

  const value = input.value;
  // Preserve empty drafts, signs, decimals and scientific notation. Do not
  // coerce through Number: that would round money and destroy partial edits.
  const normalized = value.replace(/^(-?)0+(?=\d)/, "$1");
  if (normalized === value) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const removed = value.length - normalized.length;
  // Bypass React's instance setter so its onChange observes the normalized
  // browser edit during the same input event, including controlled fields.
  setBrowserValue(input, normalized);
  if (start !== null && end !== null) {
    input.setSelectionRange(Math.max(0, start - removed), Math.max(0, end - removed));
  }
}
