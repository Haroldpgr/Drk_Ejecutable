export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parse(v: string): [number, number, number] {
  const clean = (v || "").trim().replace(/^v/i, "");
  const parts = clean.split(".");
  const n = (i: number) => {
    const raw = parts[i] ?? "0";
    const m = raw.match(/\d+/);
    return m ? Number(m[0]) : 0;
  };
  return [n(0), n(1), n(2)];
}

