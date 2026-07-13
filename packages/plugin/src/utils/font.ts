// ============================================================
// @figma-forge/plugin — 字体加载辅助
// ============================================================

/** 加载字体（带缓存和降级） */
export async function loadFont(
  fontFamily: string,
  fontStyle: string
): Promise<FontName> {
  try {
    await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
    return { family: fontFamily, style: fontStyle };
  } catch {
    // 降级到 Roboto Regular
    try {
      await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
      return { family: 'Roboto', style: 'Regular' };
    } catch {
      // 最后降级到系统字体
      await figma.loadFontAsync({ family: 'Arial', style: 'Regular' });
      return { family: 'Arial', style: 'Regular' };
    }
  }
}

/** 批量加载字体 */
export async function loadFonts(
  fonts: Array<{ family: string; style: string }>
): Promise<void> {
  const unique = new Map<string, string>();
  for (const f of fonts) {
    unique.set(f.family, f.style);
  }

  const promises: Promise<void>[] = [];
  for (const [family, style] of unique) {
    promises.push(
      figma.loadFontAsync({ family, style }).catch(() => {
        // 忽略单个字体加载失败
      })
    );
  }

  await Promise.all(promises);
}
