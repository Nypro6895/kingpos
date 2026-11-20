/** Business-date authority comes from the report lock, never the device clock. */
export function closingDisplayDifference(isPastDate: boolean, expected: number, entered: number | null) {
  return isPastDate ? (Math.round((entered ?? 0)*100)-Math.round(expected*100))/100 : null;
}
