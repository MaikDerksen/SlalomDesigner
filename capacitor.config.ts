import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "de.slalomdesigner.app",
  appName: "SlalomDesigner",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
