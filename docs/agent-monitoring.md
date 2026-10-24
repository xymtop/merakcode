# 智能体监测数据接口

监测脚本可以把文件夹变化、日志、进程状态、指标等结构化数据送回当前智能体会话。信号会先持久化，等会话空闲后作为系统通知触发智能体继续处理。

## HTTP 接口

```http
POST /monitor/:sessionID
Authorization: Bearer <session-scoped-token>
Content-Type: application/json
```

请求体：

```json
{
  "title": "Deploy folder changed",
  "message": "3 files changed in dist/",
  "severity": "info",
  "source": "folder-watch:dist",
  "data": {
    "changes": []
  },
  "dedupeKey": "sha256-of-this-event"
}
```

- `title`、`message` 必填。
- `severity` 可选 `info | warning | error`。
- `data` 为可选结构化数据，序列化后不能超过 32KB。
- `dedupeKey` 用于幂等去重；同一个 key 只会产生一个信号。
- 查询最近信号：`GET /monitor/:sessionID?limit=100`。

## 脚本环境

智能体运行 Bash 时会收到：

```text
MERAKCODE_MONITOR_URL
MERAKCODE_MONITOR_TOKEN
```

这是只允许向当前会话发送监测数据的会话级能力令牌，不包含引擎总口令。脚本应通过 `Authorization: Bearer` 使用它，禁止输出或复用到其他接口。

## 智能体接口

- MCP：`merak-apps_monitor_send`
- 内置 Skill：`agent-monitor`

`agent-monitor` Skill 说明了编写监听脚本、防止通知风暴和后台运行的规则，并提供可直接改造的 `watch-folder.mjs` 示例。文件监听器应使用 `bash_background` 启动。

## 权限与生命周期

- 只允许向令牌绑定的会话发送，不能跨会话伪造目标。
- 信号持久化在当前项目数据中，智能体确认处理后通知会从待处理队列移除。
- 会话忙碌时不会打断当前任务，空闲后再投递。
- 智能体私聊中的监测信号会同时出现在“动态”时间线。
- 引擎重启后旧令牌失效，后台脚本需要从新的智能体会话重新启动。
