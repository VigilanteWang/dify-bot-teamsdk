import { AzureAuthorityHosts } from "@azure/identity";

const botCloud =
  (process.env.BOT_CLOUD || "public").toLowerCase() === "china"
    ? "china"
    : "public";

const authorityTenant =
  process.env.BOT_AUTHORITY_TENANT ||
  process.env.TENANT_ID ||
  (botCloud === "china"
    ? "microsoftservices.partner.onmschina.cn"
    : "botframework.com");

// 兼容旧配置：如果外部仍传入 OpenID 元数据地址，则在运行时自动转换为
// JwtValidator 实际需要的 JWKS 地址，避免出现“endpoint 不包含 keys”的错误。
const normalizeBotFrameworkJwksUri = (value: string) =>
  value.includes("/.well-known/openidconfiguration")
    ? value.replace("/.well-known/openidconfiguration", "/.well-known/keys")
    : value;

// 按云环境预置 Bot Framework 的差异化终结点，避免业务代码分散处理
// 公有云与 21V 中国云的 authority、OAuth scope、issuer 与 JWKS 地址。
const defaultBotFrameworkConfig = {
  public: {
    authorityHost: AzureAuthorityHosts.AzurePublicCloud,
    oauthUrl: "https://token.botframework.com",
    toChannelFromBotLoginUrl: `https://login.microsoftonline.com/${authorityTenant}`,
    toChannelFromBotOAuthScope: "https://api.botframework.com",
    toBotFromChannelTokenIssuer: "https://api.botframework.com",
    toBotFromChannelJwksUri:
      "https://login.botframework.com/v1/.well-known/keys",
  },
  china: {
    authorityHost: AzureAuthorityHosts.AzureChina,
    oauthUrl: "https://token.botframework.azure.cn",
    toChannelFromBotLoginUrl: `https://login.partner.microsoftonline.cn/${authorityTenant}`,
    toChannelFromBotOAuthScope: "https://api.botframework.azure.cn",
    toBotFromChannelTokenIssuer: "https://api.botframework.azure.cn",
    toBotFromChannelJwksUri:
      "https://login.botframework.azure.cn/v1/.well-known/keys",
  },
} as const;

const botFramework = defaultBotFrameworkConfig[botCloud];

// 将环境变量与按云环境的默认值合并到统一配置对象中。
// 这样业务代码只依赖 config，而不需要关心当前是公有云还是 21V 中国云。
const config = {
  MicrosoftAppId: process.env.CLIENT_ID,
  MicrosoftAppType: process.env.BOT_TYPE,
  MicrosoftAppTenantId: process.env.TENANT_ID,
  MicrosoftAppPassword: process.env.CLIENT_SECRET,
  openAIKey: process.env.OPENAI_API_KEY,
  openAIModelName: process.env.OPENAI_MODEL_NAME || "gpt-5-mini",
  botFramework: {
    cloud: botCloud,
    authorityHost: process.env.BOT_AUTHORITY_HOST || botFramework.authorityHost,
    oauthUrl: process.env.BOT_OAUTH_URL || botFramework.oauthUrl,
    toChannelFromBotLoginUrl:
      process.env.BOT_TO_CHANNEL_FROM_BOT_LOGIN_URL ||
      botFramework.toChannelFromBotLoginUrl,
    toChannelFromBotOAuthScope:
      process.env.BOT_TO_CHANNEL_FROM_BOT_OAUTH_SCOPE ||
      botFramework.toChannelFromBotOAuthScope,
    toBotFromChannelTokenIssuer:
      process.env.BOT_TO_BOT_FROM_CHANNEL_TOKEN_ISSUER ||
      botFramework.toBotFromChannelTokenIssuer,
    toBotFromChannelJwksUri: normalizeBotFrameworkJwksUri(
      process.env.BOT_TO_BOT_FROM_CHANNEL_JWKS_URI ||
        process.env.BOT_TO_BOT_FROM_CHANNEL_OPENID_METADATA_URL ||
        botFramework.toBotFromChannelJwksUri,
    ),
  },
};

export default config;
