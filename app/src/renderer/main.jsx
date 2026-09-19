import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DataWindow from "./components/DataWindow";
import "./styles.css";

// The same page serves the editor and the separate data window; the window
// asks for the latter with #data in its address.
const isDataWindow = window.location.hash === "#data";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>{isDataWindow ? <DataWindow /> : <App />}</React.StrictMode>
);
