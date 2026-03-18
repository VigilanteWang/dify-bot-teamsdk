# 基础 AI 聊天机器人模板说明

这个应用模板基于 [Microsoft Teams SDK](https://aka.ms/teams-ai-library-v2) 构建。
它演示了一个类似 ChatGPT 的智能体应用，可以在 Teams 中响应用户问题，让用户直接与 AI 代理交互。

## 模板快速开始

> **前置条件**
>
> 在本地开发机运行此模板前，需要准备：
>
> - [Node.js](https://nodejs.org/)，支持版本：20、22。
> - 最新版 [Microsoft 365 Agents Toolkit Visual Studio Code 扩展](https://aka.ms/teams-toolkit) 或 [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli)。
> - 一个 [OpenAI](https://platform.openai.com/) 账号。

> 如果你打算通过 Microsoft 365 Agents Toolkit CLI 进行本地调试，还需要完成 [为本地调试配置 Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-cli-debugging) 中描述的额外步骤。

1. 在 VS Code 左侧工具栏中选择 Microsoft 365 Agents Toolkit 图标。
1. 在 env/.env.playground.user 中填写 OpenAI 密钥：`SECRET_OPENAI_API_KEY=<你的密钥>`。
1. 按 F5 启动调试，并选择 `Debug in Microsoft 365 Agents Playground`。
1. 在打开的 Microsoft 365 Agents Playground 中发送任意消息，即可获得代理回复。

现在你已经可以在 Microsoft 365 Agents Playground 中与该应用交互。

![Basic AI Chatbot](https://github.com/user-attachments/assets/984af126-222b-4c98-9578-0744790b103a)

## 模板包含内容

| 目录         | 内容                 |
| ------------ | -------------------- |
| `.vscode`    | VS Code 调试相关文件 |
| `appPackage` | 应用清单模板         |
| `env`        | 环境变量文件         |
| `infra`      | Azure 资源预配模板   |
| `src`        | 应用源代码           |

下面这些文件通常需要按你的业务进行调整：

| 文件                       | 说明                           |
| -------------------------- | ------------------------------ |
| `src/index.ts`             | 应用入口文件                   |
| `src/config.ts`            | 运行时环境变量与云环境配置     |
| `src/app/instructions.txt` | Prompt 指令内容                |
| `src/app/app.ts`           | 基础 AI 聊天机器人核心业务逻辑 |

下面这些文件是 Microsoft 365 Agents Toolkit 项目特有文件。如需了解其工作方式，可参考 [Github 上的完整说明](https://github.com/OfficeDev/TeamsFx/wiki/Teams-Toolkit-Visual-Studio-Code-v5-Guide#overview)。

| 文件                        | 说明                                                    |
| --------------------------- | ------------------------------------------------------- |
| `m365agents.yml`            | 主项目文件，定义属性与各阶段配置                        |
| `m365agents.local.yml`      | 基于主文件覆盖本地运行与调试行为                        |
| `m365agents.playground.yml` | 基于主文件覆盖 Microsoft 365 Agents Playground 调试行为 |

## 21V 中国云本地调试

当前仓库已经补充了一条最小化的 21V 本地调试路径，不依赖 Toolkit 的完整预配与部署流程。

1. 在 env/.env.21v 中填写可共享的基础配置：
   - `BOT_TYPE`（21V 场景建议默认使用 `SingleTenant`）
   - `BOT_AUTHORITY_TENANT`（仅旧版多租户 Bot 需要）
1. 复制 env/.env.21v.user.example 到 env/.env.21v.user，并填写你自己的本地/租户配置：
   - `TEAMS_APP_ID`
   - `BOT_ID`
   - `BOT_DOMAIN`
   - `BOT_ENDPOINT`
   - `CLIENT_ID`
   - `TENANT_ID`
   - `CLIENT_SECRET`
   - `OPENAI_API_KEY`
1. 在将应用包上传到 21V 租户前，手动更新 appPackage/manifest.json。
1. 按 F5 并选择 `Debug in Teams (21V Local)`。
1. 预启动任务完成后，Bot 会在本地 3978 端口监听，同时 dev tunnel 地址会写入 env/.env.21v.user（不会写回可提交的 env/.env.21v）。
1. 手动上传 manifest 后，在 21V Teams 客户端中测试该应用。

当 `BOT_CLOUD=china` 时，运行时默认使用 Azure 中国云的 Bot Framework 终结点。如果你的 Bot 注册使用了自定义地址，可在 env/.env.21v.user 中覆盖。

21V 兼容性改造的完整说明、问题根因与解决方案，请查看：[docs/21v-compatibility.md](docs/21v-compatibility.md)。

21V Bot 终结点参考文档：
https://learn.microsoft.com/en-us/azure/bot-service/how-to-deploy-china-cloud?view=azure-bot-service-4.0&tabs=csharp

## 扩展模板

如果你想为这个基础 AI 聊天机器人模板添加更多 AI 能力，可以参考 [Microsoft Teams SDK 文档](https://aka.ms/m365-agents-toolkit/teams-agent-extend-ai)。

## 附加信息与参考资料

- [Microsoft 365 Agents Toolkit 文档](https://docs.microsoft.com/microsoftteams/platform/toolkit/teams-toolkit-fundamentals)
- [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli)
- [Microsoft 365 Agents Toolkit 示例](https://github.com/OfficeDev/TeamsFx-Samples)
