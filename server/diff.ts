/** Diff de linhas (LCS) entre texto gerado e texto final — auditoria da revisão do médico. */
export interface LineDiff {
  op: '=' | '+' | '-';
  line: string;
}

export function lineDiff(a: string, b: string): LineDiff[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: '=', line: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', line: x[i++] });
    else out.push({ op: '+', line: y[j++] });
  }
  while (i < n) out.push({ op: '-', line: x[i++] });
  while (j < m) out.push({ op: '+', line: y[j++] });
  return out;
}

/** Só as alterações (o que vai para diff_from_generated). */
export function changesOnly(a: string, b: string): LineDiff[] {
  return lineDiff(a, b).filter((d) => d.op !== '=');
}
