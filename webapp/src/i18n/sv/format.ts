/** A number with the decimal comma Swedish writes: `4.5` → `4,5`. */
export function decimal(value: number | string): string {
  return String(value).replace('.', ',');
}
