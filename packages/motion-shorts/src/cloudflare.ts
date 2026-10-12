/** Accept the dashboard names as well as the original pipeline configuration. */
export function cloudflareEnv(env=process.env):NodeJS.ProcessEnv{
  return {
    ...env,
    R2_ACCOUNT_ID:env.R2_ACCOUNT_ID?.trim()||env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    R2_ACCESS_KEY_ID:env.R2_ACCESS_KEY_ID?.trim()||env.CLOUDFLARE_ACCESS_KEY_ID?.trim(),
    R2_SECRET_ACCESS_KEY:env.R2_SECRET_ACCESS_KEY?.trim()||env.CLOUDFLARE_SECRET_ACCESS_KEY?.trim(),
  };
}
