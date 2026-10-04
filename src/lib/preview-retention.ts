/** Generation state is not preview state: stopping the agent must not unmount the app. */
export function shouldRetainPreview(input: { usableHtml: boolean; liveUrl: string; browserRuntimeUrl: string }): boolean {
  return input.usableHtml || Boolean(input.liveUrl.trim()) || Boolean(input.browserRuntimeUrl.trim());
}
