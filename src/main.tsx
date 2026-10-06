import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "@/components/app/providers";
import { DecoderApp } from "@/components/app/decoder-app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <DecoderApp />
    </Providers>
  </StrictMode>,
);
