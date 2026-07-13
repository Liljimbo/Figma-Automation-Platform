// ============================================================
// @figma-bridge/plugin — 节点序列化工具
// ============================================================

/** 序列化节点为可传输的 JSON 对象 */
export function serializeNode(
  node: SceneNode,
  properties?: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: 'visible' in node ? node.visible : true,
  };

  // 安全获取可选属性
  if ('opacity' in node) result.opacity = node.opacity;
  if ('x' in node) result.x = node.x;
  if ('y' in node) result.y = node.y;
  if ('width' in node) result.width = node.width;
  if ('height' in node) result.height = node.height;
  if ('rotation' in node) result.rotation = node.rotation;

  // 如果指定了属性列表，只返回指定属性
  if (properties && properties.length > 0) {
    const filtered: Record<string, unknown> = { id: result.id, type: result.type };
    for (const prop of properties) {
      if (prop in result) {
        filtered[prop] = result[prop];
      } else {
        // 尝试从节点直接读取
        try {
          filtered[prop] = (node as unknown as Record<string, unknown>)[prop];
        } catch {
          // 忽略不可读属性
        }
      }
    }
    return filtered;
  }

  // 填充信息
  if ('fills' in node && node.fills !== figma.mixed) {
    result.fills = node.fills;
  }

  // 描边信息
  if ('strokes' in node && Array.isArray((node as RectangleNode).strokes) && (node as RectangleNode).strokes.length > 0) {
    result.strokes = (node as RectangleNode).strokes;
    result.strokeWeight = (node as RectangleNode).strokeWeight;
  }

  // 圆角
  if ('cornerRadius' in node) {
    result.cornerRadius = (node as RectangleNode).cornerRadius;
  }

  // Auto Layout
  if ('layoutMode' in node) {
    const frame = node as FrameNode;
    result.layoutMode = frame.layoutMode;
    result.paddingLeft = frame.paddingLeft;
    result.paddingRight = frame.paddingRight;
    result.paddingTop = frame.paddingTop;
    result.paddingBottom = frame.paddingBottom;
    result.itemSpacing = frame.itemSpacing;
  }

  // 文本属性
  if (node.type === 'TEXT') {
    const text = node as TextNode;
    result.characters = text.characters;
    result.fontSize = text.fontSize;
    result.fontName = text.fontName;
    result.textAlignHorizontal = text.textAlignHorizontal;
  }

  // 效果
  if ('effects' in node && node.effects.length > 0) {
    result.effects = node.effects;
  }

  return result;
}
