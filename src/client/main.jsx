import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.jsx";
import "./app/app.css";
import "./app/apple-platform.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
