# 21V 中国云兼容性改造说明

本文档专门记录为了让当前 Bot 在 21V 中国云中完成本地调试、Bot Service Web Chat 测试以及 21V Teams 消息收发而做的兼容性改造。

## 改造目标

本仓库原始模板默认面向公有云环境。要让它在 21V 中国云可用，需要同时解决以下几类问题：

1. 运行时默认终结点仍指向公有云。
1. 入站令牌校验默认不适配 21V Bot Framework 身份端点。
1. 出站 Bot token 获取过程会错误落到公有云 AAD 登录地址。
1. 21V Teams 通道对流式回复的支持与公有云存在差异。
1. 需要提供一套独立的本地调试环境文件与 VS Code 调试入口。

## 兼容性改造清单

### 1. 新增 21V 本地调试环境文件

涉及内容：

1. 新增 21V 专用环境文件，用于区分公有云与中国云配置。
1. 将非敏感配置与敏感配置分开保存，便于提交与本地覆盖。
1. 通过本地调试任务把 env/.env.21v 与 env/.env.21v.user 合并为运行时配置文件。

目的：

1. 避免污染原有公有云本地调试流程。
1. 明确 21V 所需的租户、Bot、OpenAI 以及 tunnel 参数。

### 2. 按云环境切换 Bot Framework 默认终结点

涉及文件：

1. src/config.ts

发现的问题：

1. 原始模板默认使用公有云 Bot Framework 相关地址。
1. 21V 中国云使用独立的 authorityHost、oauthUrl、issuer 与 JWKS 地址。

原因：

1. 公有云与中国云属于不同云环境，身份服务、Bot Framework 服务地址并不相同。

解决方式：

1. 新增按 `BOT_CLOUD` 选择的默认配置。
1. 为公有云与中国云分别定义：
   - authorityHost
   - oauthUrl
   - toChannelFromBotLoginUrl
   - toChannelFromBotOAuthScope
   - toBotFromChannelTokenIssuer
   - toBotFromChannelJwksUri
1. 统一将环境变量与默认值合并成单一 config 对象供业务代码使用。

效果：

1. 同一套代码可以通过环境变量切换公有云与中国云运行时行为。

### 3. 修复入站 JWT 校验使用了错误的元数据地址

涉及文件：

1. src/config.ts
1. src/app/app.ts

发现的问题：

1. Web Chat 调用时，运行时报错提示 JWKS endpoint 不包含 keys。

原因：

1. JwtValidator 需要的是直接返回 `keys` 数组的 JWKS 地址。
1. 代码里误用了 OpenID 配置地址 `/.well-known/openidconfiguration`。
1. 该地址只返回元数据对象，其中包含 `jwks_uri` 字段，但本身并不返回 `keys` 数组。

解决方式：

1. 将配置项改为直接使用 `/.well-known/keys`。
1. 新增 `normalizeBotFrameworkJwksUri`，兼容旧环境变量仍传入 OpenID metadata 地址的情况。
1. 手动创建 `JwtValidator`，并显式指定：
   - clientId
   - tenantId
   - allowedIssuer
   - jwksUriOptions

效果：

1. 21V Bot Service Web Chat 可以正确完成入站 token 校验。

### 4. 修复出站 Bot token 获取错误使用公有云登录地址

涉及文件：

1. src/app/app.ts

发现的问题：

1. 在 21V Teams 或其他 Bot 回发场景中，日志报错：Tenant not found。

原因：

1. `@microsoft/teams.apps` 内置 `TokenManager` 在存在 `CLIENT_SECRET` 时，会优先走内部的 client credentials 分支。
1. 该分支内部将 authority 固定为公有云的 `login.microsoftonline.com/{tenantId}`。
1. 对 21V 中国云租户，这会导致到错误的 AAD 云环境中查租户，最终返回 `AADSTS90002 Tenant not found`。

解决方式：

1. 自己实现 `createTokenFactory`，统一使用 `@azure/identity` 获取 Bot token。
1. 在 `ClientSecretCredential` 中显式传入 `authorityHost`，确保中国云使用 `login.partner.microsoftonline.cn`。
1. 创建 `App` 时显式传入空字符串 `clientSecret: ""`，阻止 SDK 回退读取 `process.env.CLIENT_SECRET` 并走其默认公有云逻辑。

效果：

1. 出站 token 会使用当前云环境对应的身份端点获取，不再误打到公有云。

### 5. 手动接管 /api/messages 的入站鉴权

涉及文件：

1. src/app/app.ts

发现的问题：

1. 默认处理链对 21V 中国云的身份端点与 issuer 支持不足，难以准确覆盖当前场景。

原因：

1. 模板与 SDK 默认路径更偏向公有云预设。

解决方式：

1. 通过 `HttpPlugin.onInit` 手动注册 `/api/messages`。
1. 在进入正式业务逻辑前，先使用 `JwtValidator` 校验 bearer token。
1. 同时校验 `serviceUrl`，保证请求没有被转发到错误的消息服务地址。
1. 校验通过后，把 `validatedToken` 挂到请求对象上，再继续交给 SDK 后续处理链。

效果：

1. 21V 与公有云都可以走同一套手动、可控的入站校验逻辑。

### 6. 对 21V Teams 关闭流式回复，对公有云保留流式能力

涉及文件：

1. src/app/app.ts

发现的问题：

1. Bot Service Web Chat 测试通过后，在 21V Teams 中发消息会返回 405 Method Not Allowed。
1. 错误出现在 `@teams/app/http/stream/retry` 路径，且请求体中包含 `streaminfo`。

原因：

1. 当前 21V Teams 通道对 SDK 发送的流式分片回复不兼容。
1. 流式请求会以分片活动形式发送到消息通道，而该通道在当前环境下返回 405。

解决方式：

1. 在启动时根据云环境一次性决定是否启用流式输出。
1. 中国云统一使用非流式回复。
1. 公有云保持原有流式能力不变。

效果：

1. 21V Teams 可以稳定收发消息。
1. 商业云不会因为这次兼容改造而失去流式能力。

## 当前兼容策略总结

当前代码采用的核心策略如下：

1. 通过 `BOT_CLOUD` 在公有云与中国云之间切换默认配置。
1. 入站 token 校验手动指定 issuer 与 JWKS。
1. 出站 token 获取完全走自定义 token factory。
1. 创建 App 时显式阻断 SDK 对 `CLIENT_SECRET` 的公有云回退路径。
1. 中国云关闭流式回复，公有云继续开启流式回复。

## 已知结论

1. 21V Bot Service Web Chat 已可正常测试。
1. 21V Teams 在关闭流式回复后可规避 405 问题。
1. 这套改造保持了公有云的原有流式体验，不会把所有环境都降级为非流式。

## 建议阅读顺序

如果你需要继续维护这套兼容逻辑，建议按以下顺序阅读：

1. README.md 中的 21V 本地调试说明。
1. src/config.ts 中的云环境配置逻辑。
1. src/app/app.ts 中的入站鉴权、出站 token 获取与流式策略逻辑。
