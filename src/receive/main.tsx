import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import ReceiveApp from "./ReceiveApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReceiveApp />
  </StrictMode>,
);
