/**
 * 共享路径工具 —— 兼容 Node 16。
 *
 * 为什么不用 `import.meta.dirname`：那是 Node 20.11+ 才有的 API，
 * 而线上服务器是 Ubuntu 18.04（glibc 2.27），只能跑 Node 16.20.2，
 * 用 `import.meta.dirname` 会直接抛错。`fileURLToPath` 从 Node 10 就有，两边都安全。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 项目根目录（scripts/ 的上一级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 任意模块自身所在目录（需要时用） */
export const dirOf = (metaUrl) => path.dirname(fileURLToPath(metaUrl));
