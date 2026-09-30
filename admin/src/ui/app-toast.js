/** 应用级 Toast 单例：供各模块共享同一个实现 */
import { createToast } from './toast.js';

export const toast = createToast();
