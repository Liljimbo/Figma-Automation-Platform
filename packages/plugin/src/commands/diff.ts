// ============================================================
// @figma-bridge/plugin — Diff Engine 命令处理器
// 节点快照序列化，用于 Diff Engine 的状态对比
// ============================================================

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** 快照节点：深度序列化节点树 */
const snapshotNode: CommandHandler = async (params) => {
  const { nodeId, depth = 10 } = params as { nodeId?: string; depth?: number };

  const rootNode = nodeId
    ? figma.getNodeById(nodeId)
    : figma.currentPage;

  if (!rootNode) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  function serialize(node: BaseNode, currentDepth: number): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      id: node.id,
      name: node.name,
      type: node.type,
    };

    const props: Record<string, unknown> = {};

    // 基础几何属性
    if ('x' in node) props.x = (node as SceneNode).x;
    if ('y' in node) props.y = (node as SceneNode).y;
    if ('width' in node) props.width = (node as SceneNode).width;
    if ('height' in node) props.height = (node as SceneNode).height;
    if ('opacity' in node) props.opacity = (node as BlendMixin).opacity;
    if ('visible' in node) props.visible = (node as SceneNode).visible;
    if ('rotation' in node) props.rotation = (node as any).rotation;

    // 填充和描边
    if ('fills' in node) {
      const fills = (node as MinimalFillsMixin).fills;
      if (Array.isArray(fills)) {
        props.fills = fills.map(f => {
          if (f.type === 'SOLID') {
            return { type: 'SOLID', color: f.color, opacity: f.opacity };
          }
          return { type: f.type };
        });
      }
    }

    if ('strokes' in node) {
      const n = node as SceneNode;
      if ('strokes' in n) {
        props.strokes = (n as any).strokes;
        props.strokeWeight = (n as any).strokeWeight;
      }
    }

    // 圆角
    if ('cornerRadius' in node) {
      const n = node as any;
      props.cornerRadius = n.cornerRadius;
    }

    // Auto Layout
    if ('layoutMode' in node) {
      const frame = node as FrameNode;
      if (frame.layoutMode !== 'NONE') {
        props.layoutMode = frame.layoutMode;
        props.paddingLeft = frame.paddingLeft;
        props.paddingRight = frame.paddingRight;
        props.paddingTop = frame.paddingTop;
        props.paddingBottom = frame.paddingBottom;
        props.itemSpacing = frame.itemSpacing;
      }
    }

    // 文本属性
    if (node.type === 'TEXT') {
      const text = node as TextNode;
      props.characters = text.characters;
      props.fontSize = text.fontSize;
      props.fontName = text.fontName;
      props.textAlignHorizontal = text.textAlignHorizontal;
      props.textAutoResize = text.textAutoResize;
    }

    snapshot.properties = props;

    // 子节点
    if ('children' in node && currentDepth < depth) {
      const parent = node as ChildrenMixin;
      snapshot.children = (parent.children as readonly BaseNode[]).map(child =>
        serialize(child, currentDepth + 1)
      );
    }

    return snapshot;
  }

  return serialize(rootNode, 0);
};

export const diffHandlers: Record<string, CommandHandler> = {
  snapshotNode,
};
