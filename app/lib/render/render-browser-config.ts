export const getRenderBrowserExecutable = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const executable = env.REMOTION_BROWSER_EXECUTABLE_PATH?.trim();
  if (!executable) {
    throw new Error(
      'REMOTION_BROWSER_EXECUTABLE_PATH is required for bounded server rendering. Provision Chrome before accepting render requests.',
    );
  }
  return executable;
};
