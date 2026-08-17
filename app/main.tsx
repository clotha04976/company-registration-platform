import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./page";
import "./globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("找不到掛載節點 #root。");

createRoot(container).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
