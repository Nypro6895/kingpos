export class PayrollWriteError extends Error {
  constructor(message: string, public readonly outcomeUnknown: boolean) { super(message); }
}
export function payrollWriteFailure(error: {code?: string; message: string}) {
  const known = ["P0001", "PT409", "42501", "22P02", "22003", "22023", "23503", "23514"].includes(error.code ?? "");
  return new PayrollWriteError(known ? error.message : "The result is not confirmed. Check the saved record or retry the same request.", !known);
}
