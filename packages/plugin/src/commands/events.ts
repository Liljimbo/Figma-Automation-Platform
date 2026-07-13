// ============================================================
// @figma-forge/plugin — Event Listener 命令处理器
// 监听 Figma 文档变化并通过 UI iframe 发送给 Bridge
// ============================================================

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

const activeListeners = new Map<string, () => void>();

/** 开始监听文档事件 */
const startListening: CommandHandler = async (params) => {
  const { events } = params as { events: string[] };

  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array');
  }

  const started: string[] = [];

  for (const eventName of events) {
    if (activeListeners.has(eventName)) {
      continue; // 已在监听
    }

    let cleanup: (() => void) | null = null;

    if (eventName === 'selectionchange') {
      const handler = () => {
        const selection = figma.currentPage.selection.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
        }));
        figma.ui.postMessage({
          type: 'event',
          payload: { event: 'selectionchange', timestamp: Date.now(), data: { selection } },
        });
      };
      figma.on('selectionchange', handler);
      cleanup = () => figma.off('selectionchange', handler);
    } else if (eventName === 'currentpagechange') {
      const handler = () => {
        figma.ui.postMessage({
          type: 'event',
          payload: {
            event: 'currentpagechange',
            timestamp: Date.now(),
            data: { pageId: figma.currentPage.id, pageName: figma.currentPage.name },
          },
        });
      };
      figma.on('currentpagechange', handler);
      cleanup = () => figma.off('currentpagechange', handler);
    } else if (eventName === 'documentchange') {
      const handler = (event: DocumentChangeEvent) => {
        const changes = event.documentChanges.map(c => ({
          type: c.type,
          id: c.id,
          properties: c.type === 'PROPERTY_CHANGE' ? c.properties : undefined,
        }));
        figma.ui.postMessage({
          type: 'event',
          payload: { event: 'documentchange', timestamp: Date.now(), data: { changes } },
        });
      };
      figma.on('documentchange', handler);
      cleanup = () => figma.off('documentchange', handler);
    } else {
      throw new Error(`Unknown event type: ${eventName}`);
    }

    if (cleanup) {
      activeListeners.set(eventName, cleanup);
      started.push(eventName);
    }
  }

  return { started, active: Array.from(activeListeners.keys()) };
};

/** 停止监听 */
const stopListening: CommandHandler = async (params) => {
  const { events } = params as { events?: string[] };

  const toStop = events || Array.from(activeListeners.keys());
  const stopped: string[] = [];

  for (const eventName of toStop) {
    const cleanup = activeListeners.get(eventName);
    if (cleanup) {
      cleanup();
      activeListeners.delete(eventName);
      stopped.push(eventName);
    }
  }

  return { stopped, active: Array.from(activeListeners.keys()) };
};

export const eventsHandlers: Record<string, CommandHandler> = {
  startListening,
  stopListening,
};
