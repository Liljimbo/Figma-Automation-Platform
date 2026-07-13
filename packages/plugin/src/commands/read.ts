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

  if ('opacity' in sceneNode) result.opacity = sceneNode.opacity;
  if ('x' in sceneNode) result.x = sceneNode.x;
  if ('y' in sceneNode) result.y = sceneNode.y;
  if ('width' in sceneNode) result.width = sceneNode.width;
  if ('height' in sceneNode) result.height = sceneNode.height;
  if ('rotation' in sceneNode) result.rotation = sceneNode.rotation;

  const sections = include || properties || [];
  const includeAll = sections.length === 0;

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

  if (includeAll || sections.includes('effects')) {
    if ('effects' in sceneNode) {
      result.effects = sceneNode.effects;
    }
  }

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
      if (text.fontName !== figma.mixed) {
        result.fontFamily = text.fontName.family;
        result.fontStyle = text.fontName.style;
      }
    }
  }

  if (includeAll || sections.includes('constraints')) {
    if ('constraints' in sceneNode) {
      result.constraints = (sceneNode as FrameNode).constraints;
    }
  }

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

// ─── findNodes — 增强版（修复正则注入）────────────────────────

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
      if (name) {
        const escaped = name.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
          '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          'i'
        );
        if (!pattern.test(node.name)) continue;
      }

      if (typeSet && !typeSet.has(node.type)) continue;

      if (!matchesPropertyFilter(node)) continue;

      results.push({
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible,
      });

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

export const readHandlers: Record<string, CommandHandler> = {
  getNodeProperties,
  findNodes,
  getStyles,
};
