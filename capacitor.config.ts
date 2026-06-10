import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "de.kartslalom.planner",
  appName: "Kart Slalom Planner",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
