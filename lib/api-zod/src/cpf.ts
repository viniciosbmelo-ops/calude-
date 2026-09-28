export function normalizeCpf(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const digit = (sum * 10) % 11;
    return digit === 10 ? 0 : digit;
  };

  return (
    calculateDigit(9) === Number(cpf[9]) &&
    calculateDigit(10) === Number(cpf[10])
  );
}