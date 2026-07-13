// ============================================================
// @figma-forge/plugin — 颜色转换工具
// ============================================================

/** Hex 颜色转 RGB（0-1 范围） */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  let r: number, g: number, b: number;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
  } else {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return { r, g, b };
}

/** RGB（0-1 范围）转 Hex */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => {
    const hex = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 创建 Figma 颜色对象 */
export function createFigmaColor(
  r: number,
  g: number,
  b: number,
  a?: number
): { r: number; g: number; b: number; a?: number } {
  return { r, g, b, a: a ?? 1 };
}
