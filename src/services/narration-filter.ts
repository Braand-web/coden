/** Keep fenced file bodies out of public prose, including fences split across chunks. */
export function createNarrationFilter() {
  let fence: string | null = null; let held = '';
  return (fragment: string) => {
    const text = held + fragment; held = ''; let out = '';
    for (let i = 0; i < text.length;) {
      const c = text[i];
      if (c === '`' || c === '~') {
        let end = i; while (text[end] === c) end++;
        const n = end - i;
        if (end === text.length && n < 3) { held = text.slice(i); break; }
        if (n >= 3) { if (!fence) fence = c; else if (fence === c) fence = null; }
        else if (!fence) out += text.slice(i, end);
        i = end;
      } else { if (!fence) out += c; i++; }
    }
    return out;
  };
}
