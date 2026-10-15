import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/app/App";
import { installChunkRecovery } from "@/app/chunk-recovery";
import "@/index.css";

installChunkRecovery();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
