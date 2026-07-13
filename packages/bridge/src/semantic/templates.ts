// ============================================================
// @figma-forge/core — Template Registry
// 预定义设计模板的注册、查询、实例化
// ============================================================

import type { TemplateDefinition } from '@figma-forge/shared';

export class TemplateRegistry {
  private templates = new Map<string, TemplateDefinition>();

  constructor() {
    this.registerBuiltInTemplates();
  }

  /** 注册模板 */
  register(template: TemplateDefinition): void {
    this.templates.set(template.name, template);
  }

  /** 获取模板 */
  get(name: string): TemplateDefinition | undefined {
    return this.templates.get(name);
  }

  /** 列出所有模板 */
  list(): Array<{ name: string; description: string; parameters?: Record<string, unknown> }> {
    return Array.from(this.templates.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as Record<string, unknown>,
    }));
  }

  /** 将模板中的参数占位符替换为实际值 */
  instantiate(
    template: TemplateDefinition,
    parameters: Record<string, unknown> = {},
    parentId?: string
  ): Array<{ tool: string; params: Record<string, unknown> }> {
    // 合并默认值：模板定义的 default < 用户传入的 parameters
    const mergedParams = { ...parameters };
    if (template.parameters) {
      for (const [key, def] of Object.entries(template.parameters)) {
        if (!(key in mergedParams) && def && typeof def === 'object' && 'default' in def) {
          mergedParams[key] = (def as { default: unknown }).default;
        }
      }
    }

    return template.tools.map(entry => {
      const params = JSON.parse(JSON.stringify(entry.params));
      this.resolveParams(params, mergedParams);
      if (parentId && !params.parentId) {
        params.parentId = parentId;
      }
      return { tool: entry.tool, params };
    });
  }

  /** 递归替换参数占位符（格式：${paramName}），支持嵌入式替换 */
  private resolveParams(obj: Record<string, unknown>, parameters: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // 完整匹配：值就是 "${paramName}"
        if (value.startsWith('${') && value.endsWith('}')) {
          const paramName = value.slice(2, -1);
          if (paramName in parameters) {
            obj[key] = parameters[paramName];
          }
        // 嵌入式匹配：字符串中包含 "${paramName}"
        } else if (value.includes('${')) {
          obj[key] = value.replace(/\$\{(\w+)\}/g, (_, paramName) => {
            return paramName in parameters ? String(parameters[paramName]) : `\${${paramName}}`;
          });
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.resolveParams(value as Record<string, unknown>, parameters);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            this.resolveParams(item as Record<string, unknown>, parameters);
          }
        }
      }
    }
  }

  /** 注册内置模板 */
  private registerBuiltInTemplates(): void {
    // 用户卡片模板
    this.register({
      name: 'user-card',
      description: '用户信息卡片，包含头像、姓名、简介和操作按钮',
      parameters: {
        title: { type: 'string', description: '用户名', default: 'User Name' },
        description: { type: 'string', description: '用户简介', default: 'User description' },
        width: { type: 'number', description: '卡片宽度', default: 320 },
      },
      tools: [
        {
          tool: 'create_card',
          params: {
            name: '${title}-card',
            title: '${title}',
            description: '${description}',
            width: '${width}',
            variant: 'elevated',
          },
        },
      ],
    });

    // 导航栏模板
    this.register({
      name: 'navbar',
      description: '顶部导航栏，包含 Logo、导航链接和操作按钮',
      parameters: {
        title: { type: 'string', description: 'Logo 文字', default: 'App' },
      },
      tools: [
        {
          tool: 'create_header',
          params: {
            name: 'main-navbar',
            title: '${title}',
            actions: ['Login', 'Sign Up'],
          },
        },
      ],
    });

    // 表单模板
    this.register({
      name: 'login-form',
      description: '登录表单，包含邮箱和密码输入框及提交按钮',
      parameters: {
        title: { type: 'string', description: '表单标题', default: 'Login' },
      },
      tools: [
        {
          tool: 'create_form',
          params: {
            name: 'login-form',
            title: '${title}',
            fields: [
              { type: 'email', label: 'Email', placeholder: 'Enter your email' },
              { type: 'password', label: 'Password', placeholder: 'Enter your password' },
            ],
          },
        },
      ],
    });

    // Hero 区域模板
    this.register({
      name: 'hero-section',
      description: '页面 Hero 区域，包含标题、副标题和 CTA 按钮',
      parameters: {
        title: { type: 'string', description: '主标题', default: 'Welcome' },
        subtitle: { type: 'string', description: '副标题', default: 'Get started today' },
      },
      tools: [
        {
          tool: 'create_hero',
          params: {
            name: 'main-hero',
            title: '${title}',
            subtitle: '${subtitle}',
            cta: 'Get Started',
          },
        },
      ],
    });
  }
}
