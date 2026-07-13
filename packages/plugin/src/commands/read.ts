// ============================================================
// @figma-forge/plugin — 增强读取命令
// ============================================================

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ─── getNodeProperties — 增强版 ─────────────────────────────

export const getNodeProperties: CommandHandler = async (params) => {
  const { nodeId, properties, include } = params as {
    nodeId: string;
    properties?: string[];
    include?: string[];
  };

  const node = figma.getNodeById(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const sceneNode = node as SceneNode;
  const result: Record<string, unknown> = {
    id: sceneNode.id,
    name: sceneNode.name,
    type: sceneNode.type,
    visible: sceneNode.visible,
  };

  // 基础属性
  if ('opacity' in sceneNode) result.opacity = sceneNode.opacity;
  if ('x' in sceneNode) result.x = sceneNode.x;
  if ('y' in sceneNode) result.y = sceneNode.y;
  if ('width' in sceneNode) result.width = sceneNode.width;
  if ('height' in sceneNode) result.height = sceneNode.height;
  if ('rotation' in sceneNode) result.rotation = sceneNode.rotation;

  // 收集要读取的属性类别
  const sections = include || properties || [];
  const includeAll = sections.length === 0;

  // 填充 (fills)
  if (includeAll || sections.includes('fills')) {
    if ('fills' in sceneNode && sceneNode.fills !== figma.mixed) {
      result.fills = sceneNode.fills;
    }
    if ('fillGeometry' in sceneNode) {
      try {
        result.fillGeometry = (sceneNode as RectangleNode).fillGeometry;
      } catch { /* ignore */ }
    }
  }

  // 描边 (stroke)
  if (includeAll || sections.includes('stroke')) {
    if ('strokes' in sceneNode && Array.isArray(sceneNode.strokes) && sceneNode.strokes.length > 0) {
      result.strokes = sceneNode.strokes;
    }
    if ('strokeWeight' in sceneNode) {
      result.strokeWeight = (sceneNode as RectangleNode).strokeWeight;
    }
    if ('strokeAlign' in sceneNode) {
      result.strokeAlign = (sceneNode as RectangleNode).strokeAlign;
    }
    if ('strokeDashes' in sceneNode) {
      result.strokeDashes = (sceneNode as unknown as { strokeDashes: number[] }).strokeDashes;
    }
  }

  // 效果 (effects: shadow, blur, etc.)
  if (includeAll || sections.includes('effects')) {
    if ('effects' in sceneNode) {
      result.effects = sceneNode.effects;
    }
  }

  // 布局 (layout)
  if (includeAll || sections.includes('layout')) {
    if ('layoutMode' in sceneNode) {
      const frame = sceneNode as FrameNode;
      result.layoutMode = frame.layoutMode;
      result.paddingLeft = frame.paddingLeft;
      result.paddingRight = frame.paddingRight;
      result.paddingTop = frame.paddingTop;
      result.paddingBottom = frame.paddingBottom;
      result.itemSpacing = frame.itemSpacing;
      result.counterAxisAlignItems = frame.counterAxisAlignItems;
      result.primaryAxisAlignItems = frame.primaryAxisAlignItems;
      result.layoutAlign = frame.layoutAlign;
      result.layoutGrow = frame.layoutGrow;
      result.layoutSizingHorizontal = frame.layoutSizingHorizontal;
      result.layoutSizingVertical = frame.layoutSizingVertical;
      if ('layoutWrap' in frame) {
        result.layoutWrap = frame.layoutWrap;
      }
    }
  }

  // 圆角 (corner)
  if (includeAll || sections.includes('corner')) {
    if ('cornerRadius' in sceneNode) {
      result.cornerRadius = (sceneNode as RectangleNode).cornerRadius;
    }
    if ('topLeftRadius' in sceneNode) {
      result.topLeftRadius = (sceneNode as RectangleNode).topLeftRadius;
      result.topRightRadius = (sceneNode as RectangleNode).topRightRadius;
      result.bottomLeftRadius = (sceneNode as RectangleNode).bottomLeftRadius;
      result.bottomRightRadius = (sceneNode as RectangleNode).bottomRightRadius;
    }
  }

  // 文本 (text)
  if (includeAll || sections.includes('text')) {
    if (sceneNode.type === 'TEXT') {
      const text = sceneNode as TextNode;
      result.characters = text.characters;
      result.fontSize = text.fontSize;
      result.fontName = text.fontName;
      result.textAlignHorizontal = text.textAlignHorizontal;
      result.textAlignVertical = text.textAlignVertical;
      result.lineHeight = text.lineHeight;
      result.letterSpacing = text.letterSpacing;
      result.textCase = text.textCase;
      result.textDecoration = text.textDecoration;
      result.textAutoResize = text.textAutoResize;
      result.paragraphSpacing = text.paragraphSpacing;
      result.paragraphIndent = text.paragraphIndent;
      // 混合字体信息
      if (text.fontName !== figma.mixed) {
        result.fontFamily = text.fontName.family;
        result.fontStyle = text.fontName.style;
      }
    }
  }

  // 约束 (constraints)
  if (includeAll || sections.includes('constraints')) {
    if ('constraints' in sceneNode) {
      result.constraints = (sceneNode as FrameNode).constraints;
    }
  }

  // 混合 (blend)
  if (includeAll || sections.includes('blend')) {
    if ('blendMode' in sceneNode) {
      result.blendMode = sceneNode.blendMode;
    }
    if ('isMask' in sceneNode) {
      result.isMask = sceneNode.isMask;
    }
    if ('clipsContent' in sceneNode) {
      result.clipsContent = (sceneNode as FrameNode).clipsContent;
    }
  }

  // 如果指定了具体属性过滤
  if (properties && properties.length > 0) {
    const filtered: Record<string, unknown> = { id: result.id, type: result.type };
    for (const prop of properties) {
      if (prop in result) {
        filtered[prop] = result[prop];
      } else {
        try {
          filtered[prop] = (sceneNode as unknown as Record<string, unknown>)[prop];
        } catch { /* ignore */ }
      }
    }
    return filtered;
  }

  return result;
};

// ─── findNodes — 增强版 ─────────────────────────────────────

export const findNodes: CommandHandler = async (params) => {
  const { name, type, pageId, recursive = true, maxDepth, propertyFilter } = params as {
    name?: string;
    type?: string | string[];
    pageId?: string;
    recursive?: boolean;
    maxDepth?: number;
    propertyFilter?: Record<string, unknown>;
  };

  let searchNodes: ReadonlyArray<SceneNode>;

  if (pageId) {
    const page = figma.getNodeById(pageId);
    if (!page || !('children' in page)) {
      throw new Error(`Page not found: ${pageId}`);
    }
    searchNodes = (page as PageNode).children;
  } else {
    searchNodes = figma.currentPage.children;
  }

  // 支持多种类型过滤
  const typeSet = type
    ? (Array.isArray(type) ? new Set(type) : new Set([type]))
    : null;

  const results: Array<Record<string, unknown>> = [];

  function matchesPropertyFilter(node: SceneNode): boolean {
    if (!propertyFilter) return true;
    for (const [key, value] of Object.entries(propertyFilter)) {
      try {
        const nodeValue = (node as unknown as Record<string, unknown>)[key];
        if (nodeValue !== value) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function search(
    nodes: ReadonlyArray<SceneNode>,
    currentDepth: number
  ) {
    for (const node of nodes) {
      // 名称匹配（支持 * 通配符和 ? 单字符匹配）
      if (name) {
        const pattern = new RegExp(
          '^' + name.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          'i'
        );
        if (!pattern.test(node.name)) continue;
      }

      // 类型匹配
      if (typeSet && !typeSet.has(node.type)) continue;

      // 属性匹配
      if (!matchesPropertyFilter(node)) continue;

      results.push({
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible,
      });

      // 递归子节点
      if (recursive && 'children' in node) {
        if (maxDepth === undefined || currentDepth < maxDepth) {
          search((node as ChildrenMixin).children, currentDepth + 1);
        }
      }
    }
  }

  search(searchNodes, 0);
  return results;
};

// ─── getStyles — 读取节点样式 ───────────────────────────────

export const getStyles: CommandHandler = async (params) => {
  const { nodeId } = params as { nodeId: string };

  const node = figma.getNodeById(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const sceneNode = node as SceneNode;
  const result: Record<string, unknown> = {
    id: sceneNode.id,
    name: sceneNode.name,
    type: sceneNode.type,
  };

  // Paint Styles（填充样式）
  if ('fillGeometry' in sceneNode && 'fills' in sceneNode) {
    try {
      const fills = sceneNode.fills;
      if (fills !== figma.mixed && Array.isArray(fills)) {
        result.paintStyles = fills.map((paint: Paint) => {
          const styleInfo: Record<string, unknown> = {
            type: paint.type,
            opacity: paint.opacity,
            blendMode: paint.blendMode,
            visible: paint.visible,
          };
          if (paint.type === 'SOLID') {
            const solid = paint as SolidPaint;
            styleInfo.color = solid.color;
          }
          if ('scaleMode' in paint) {
            styleInfo.scaleMode = (paint as ImagePaint).scaleMode;
          }
          return styleInfo;
        });
      }
    } catch { /* ignore */ }
  }

  // Stroke Styles（描边样式）
  if ('strokes' in sceneNode) {
    const strokes = (sceneNode as RectangleNode).strokes;
    if (Array.isArray(strokes) && strokes.length > 0) {
      result.strokeStyles = strokes.map((paint: Paint) => ({
        type: paint.type,
        opacity: paint.opacity,
        blendMode: paint.blendMode,
        visible: paint.visible,
        ...(paint.type === 'SOLID' ? { color: (paint as SolidPaint).color } : {}),
      }));
    }
  }

  // Effect Styles（效果样式：阴影、模糊等）
  if ('effects' in sceneNode) {
    result.effectStyles = sceneNode.effects.map((effect: Effect) => ({
      type: effect.type,
      visible: effect.visible,
      radius: 'radius' in effect ? (effect as unknown as { radius: number | typeof figma.mixed }).radius : undefined,
      spread: 'spread' in effect ? (effect as unknown as { spread: number }).spread : undefined,
      offset: 'offset' in effect ? (effect as unknown as { offset: { x: number; y: number } }).offset : undefined,
      color: 'color' in effect ? (effect as unknown as { color: RGB }).color : undefined,
    }));
  }

  // Text Styles（文本样式）
  if (sceneNode.type === 'TEXT') {
    const text = sceneNode as TextNode;
    result.textStyles = {
      fontSize: text.fontSize,
      fontName: text.fontName !== figma.mixed ? text.fontName : null,
      lineHeight: text.lineHeight,
      letterSpacing: text.letterSpacing,
      textAlignHorizontal: text.textAlignHorizontal,
      textAlignVertical: text.textAlignVertical,
      textCase: text.textCase,
      textDecoration: text.textDecoration,
    };
  }

  return result;
};

// ─── 导出所有读取 handler ────────────────────────────────────

export const readHandlers: Record<string, CommandHandler> = {
  getNodeProperties,
  findNodes,
  getStyles,
};
