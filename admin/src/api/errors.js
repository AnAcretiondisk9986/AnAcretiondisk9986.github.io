/** 管理 API 错误码与用户可读消息（与后端 code 对应）。 */
export const API_ERROR_MESSAGES = {
  VERSION_CONFLICT: '内容已在其他位置被修改，请刷新后再保存',
  VERSION_REQUIRED: '缺少版本信息，请重新加载后再操作',
  VERSION_INVALID: '版本信息格式不正确',
  INVALID_DATA: '提交的数据结构不合法',
  SLUG_EXISTS: '该 Slug 已被占用',
  MEDIA_IN_USE: '资源仍被引用，无法删除',
  PUSH_FAILED: '推送失败，请查看发布中心详情',
  PULL_FAILED: '拉取失败，请查看发布中心详情',
};

/** 从错误响应体提取可读消息 */
export function apiErrorMessage(data, fallback = '操作失败') {
  if (!data) return fallback;
  return data.error || API_ERROR_MESSAGES[data.code] || fallback;
}

/** 判断响应是否为 JSON（管理接口返回网页时给出可操作提示） */
export function isJsonResponse(res) {
  return (res.headers.get('content-type') || '').toLowerCase().includes('application/json');
}
