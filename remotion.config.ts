import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setEntryPoint(
  "./web/src/features/studio/composition/RemotionRoot.tsx",
);
