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

export const parseHardwareEncoding = (
  value: string | undefined,
): 'if-possible' | undefined => {
  if (value === undefined || value === 'off') return undefined;
  if (value === 'auto' || value === 'if-possible') return 'if-possible';
  throw new Error(
    'CLIPJS_RENDER_HW_ENCODING must be one of: auto, if-possible, off',
  );
};
