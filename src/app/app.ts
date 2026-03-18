import { App, HttpPlugin } from "@microsoft/teams.apps";
import { JwtValidator } from "@microsoft/teams.apps/dist/middleware";
import { ChatPrompt } from "@microsoft/teams.ai";
import { LocalStorage } from "@microsoft/teams.common";
import { OpenAIChatModel } from "@microsoft/teams.openai";
import {
  JsonWebToken,
  MessageActivity,
  TokenCredentials,
} from "@microsoft/teams.api";
import {
  ClientSecretCredential,
  ManagedIdentityCredential,
} from "@azure/identity";
import * as fs from "fs";
import * as path from "path";
import config from "../config";

// 使用本地存储保存会话上下文，便于多轮对话继续携带历史消息。
const storage = new LocalStorage();

// 启动时从文件读取提示词，避免在每次请求时重复访问磁盘。
function loadInstructions(): string {
  const instructionsFilePath = path.join(__dirname, "instructions.txt");
  return fs.readFileSync(instructionsFilePath, "utf-8").trim();
}

// 提示词只在启动时加载一次，后续请求直接复用。
const instructions = loadInstructions();

// 在启动时一次性确定是否启用流式输出。
// 当前 21V Teams 通道对 streaminfo 分片回复会返回 405，因此中国云统一回退为非流式；
// 公有云继续保持流式能力不变。
const useStreamingResponse = config.botFramework.cloud !== "china";

// Bot 回发消息时需要使用 Bot Framework 对应云环境的 OAuth scope。
// 这里统一从配置中拼出 /.default scope，供后续 token 获取逻辑复用。
const getBotTokenScope = () =>
  `${config.botFramework.toChannelFromBotOAuthScope}/.default`;

// 统一封装出站 token 获取逻辑，显式走我们自己的云环境配置。
// 原因是 @microsoft/teams.apps 内置 TokenManager 在存在 CLIENT_SECRET 时会优先
// 走其内部的 ClientCredentials 分支，而该分支把 authority 固定到了公有云。
// 对 21V 中国云来说，这会导致 tenant 查询落到错误的登录域名上。
const createTokenFactory = () => {
  return async (): Promise<string> => {
    const scope = getBotTokenScope();

    if (config.MicrosoftAppType === "UserAssignedMsi") {
      const managedIdentityCredential = new ManagedIdentityCredential({
        clientId: config.MicrosoftAppId,
      });
      const tokenResponse = await managedIdentityCredential.getToken(scope);

      if (!tokenResponse?.token) {
        throw new Error("无法通过托管标识获取 Bot 访问令牌。");
      }

      return tokenResponse.token;
    }

    if (
      !config.MicrosoftAppId ||
      !config.MicrosoftAppTenantId ||
      !config.MicrosoftAppPassword
    ) {
      throw new Error(
        "使用客户端密钥认证时，必须提供 CLIENT_ID、TENANT_ID 和 CLIENT_SECRET。",
      );
    }

    // 这里显式传入 authorityHost，确保 21V 中国云使用 partner.microsoftonline.cn，
    // 而不是 SDK 默认的 login.microsoftonline.com。
    const clientSecretCredential = new ClientSecretCredential(
      config.MicrosoftAppTenantId,
      config.MicrosoftAppId,
      config.MicrosoftAppPassword,
      {
        authorityHost: config.botFramework.authorityHost,
      },
    );
    const tokenResponse = await clientSecretCredential.getToken(scope);

    if (!tokenResponse?.token) {
      throw new Error("无法通过客户端密钥获取 Bot 访问令牌。");
    }

    return tokenResponse.token;
  };
};

// 为进入 /api/messages 的请求创建通道令牌校验器。
// 这里不使用 SDK 的默认校验路径，而是手动指定 issuer 与 JWKS，
// 以兼容 21V 中国云与公有云不同的 Bot Framework 身份端点。
const createChannelTokenValidator = () => {
  if (!config.MicrosoftAppId) {
    throw new Error("Bot 认证需要提供 CLIENT_ID。");
  }

  return new JwtValidator({
    clientId: config.MicrosoftAppId,
    tenantId: config.MicrosoftAppTenantId,
    validateIssuer: {
      allowedIssuer: config.botFramework.toBotFromChannelTokenIssuer,
    },
    jwksUriOptions: {
      type: "uri",
      uri: config.botFramework.toBotFromChannelJwksUri,
    },
  });
};

const httpPlugin = new HttpPlugin();

// 在 HttpPlugin 初始化时手动接管 /api/messages 的入站鉴权。
// 这样可以在请求真正进入 SDK 处理前，先按当前云环境验证 bearer token，
// 避免默认实现对 21V 中国云终结点支持不足的问题。
httpPlugin.onInit = function onInit() {
  const validator = createChannelTokenValidator();

  this.post(
    "/api/messages",
    async (req, res, next) => {
      const authorization = req.headers.authorization?.replace("Bearer ", "");

      if (!authorization) {
        res.status(401).send("未授权");
        return;
      }

      const activity = req.body;
      // serviceUrl 也参与校验，避免 token 虽然合法但被转发到了错误的消息服务地址。
      const validationResult = await validator.validateAccessToken(
        authorization,
        activity?.serviceUrl
          ? {
              validateServiceUrl: {
                expectedServiceUrl: activity.serviceUrl,
              },
            }
          : undefined,
      );

      if (!validationResult) {
        res.status(401).send("令牌无效");
        return;
      }

      // 将已验证的 JWT 挂到请求对象上，供后续 SDK 请求链继续使用。
      req.validatedToken = new JsonWebToken(authorization);
      next();
    },
    this.onRequest.bind(this),
  );
};

// 显式使用自定义 token provider，统一接管出站访问令牌获取逻辑。
const tokenCredentials: TokenCredentials = {
  clientId: config.MicrosoftAppId || "",
  token: createTokenFactory(),
};

// 创建 App 实例时把 clientSecret 显式置空。
// 这是为了阻止 SDK 回退读取 process.env.CLIENT_SECRET 并走其内置的公有云 authority。
// 只有这样，SDK 才会稳定使用上面的 token factory，从而兼容 21V 中国云。
const app = new App({
  ...tokenCredentials,
  clientSecret: "",
  tenantId: config.MicrosoftAppTenantId,
  apiClientSettings: {
    oauthUrl: config.botFramework.oauthUrl,
  },
  plugins: [httpPlugin],
  storage,
});

// 处理用户消息，并按当前运行策略选择流式或非流式回包。
app.on("message", async ({ send, stream, activity }) => {
  // 使用会话 ID 与用户 ID 组合作为上下文键，隔离不同会话的历史消息。
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];

  try {
    const prompt = new ChatPrompt({
      messages,
      instructions,
      model: new OpenAIChatModel({
        model: config.openAIModelName,
        apiKey: config.openAIKey,
      }),
    });

    if (activity.conversation.isGroup) {
      // 群聊场景统一走非流式回复，避免在多人会话里产生分片显示问题。
      const response = await prompt.send(activity.text);
      const responseActivity = new MessageActivity(response.content)
        .addAiGenerated()
        .addFeedback();
      await send(responseActivity);
    } else {
      if (useStreamingResponse) {
        // 公有云保留流式输出能力，继续按分片向客户端推送内容。
        await prompt.send(activity.text, {
          onChunk: (chunk) => {
            stream.emit(chunk);
          },
        });
        // 流式发送完成后，再补一个最终活动，附加 AI 生成与反馈元数据。
        stream.emit(new MessageActivity().addAiGenerated().addFeedback());
      } else {
        // 21V 中国云直接返回完整消息，规避 Teams 通道对 streaminfo 的 405 问题。
        const response = await prompt.send(activity.text);
        const responseActivity = new MessageActivity(response.content)
          .addAiGenerated()
          .addFeedback();
        await send(responseActivity);
      }
    }
    storage.set(conversationKey, messages);
  } catch (error) {
    console.error(error);
    await send("代理在处理请求时发生错误。");
    await send("请检查并修复当前代理代码后再继续运行。");
  }
});

app.on("message.submit.feedback", async ({ activity }) => {
  // 可以在这里扩展自定义反馈处理逻辑。
  console.log("收到反馈：" + JSON.stringify(activity.value));
});

export default app;
