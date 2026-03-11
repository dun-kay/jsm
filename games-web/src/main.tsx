import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const redirectPath = sessionStorage.getItem("notes_redirect_path");
if (redirectPath) {
  sessionStorage.removeItem("notes_redirect_path");
  window.history.replaceState({}, "", redirectPath);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
